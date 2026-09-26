# TigerData integration

The `/data` explorer and `/api/reef-data` read Tiger Cloud at request time using
`pg` from server-only modules. The home page links to the explorer. No database
credentials or CSV data are embedded in the browser bundle or production image.

The two CSVs are global (2,720 reefs) and use their own reef IDs. 740 of those
reefs are in the Florida Keys (lat 24.44–27.18, lon −82.98 to −80.02). They are
**not** joined to the nine demonstration sites in the 3D scene: no ID mapping
exists, and the Florida scene's bleaching model stays a labeled demonstration.

## Service

| | |
| --- | --- |
| Service | `db-49612` (`kv9svovb8v`), AWS us-east-1, environment `DEV` |
| Engine | PostgreSQL 18.6, TimescaleDB 2.30.1 |
| Endpoint | direct `…tsdb.cloud.timescale.com:36161`, database `tsdb` |
| TLS | TLS 1.3; certificate issued by Google Trust Services (root GTS Root R1), which Node trusts by default |

## Reviewed source files

Only these repository-root files are accepted by the importer. They are never
edited. Expected SHA-256 hashes are pinned in `datasets.mjs`.

| File | Rows | Period | Grain |
| --- | ---: | --- | --- |
| bleaching_risk_2021_2025.csv | 13,245 | 2021–2025 | Unique reef/year (2,649 reefs) |
| reef_stress_analysis.csv | 5,294 | 2013–2020 | Survey record; 528 repeated reef/year keys |

Missing values stay SQL NULL: 1,026 coral-cover, 200 bleaching, and 10 depth
values. `source_row` is the one-based CSV data-record ordinal (header excluded).

## Schema (`001_reef_data.sql`, schema `reef_data`)

- `reefs`: one row per `reef_id` with latitude/longitude. Both files repeat the same
  coordinates on every row, so they are stored once (3NF). The importer fails if a
  reef's coordinates ever disagree between files.
- `bleaching_risk`, `reef_stress`: the measurements, with foreign keys to `reefs`.
- `bleaching_risk_records`, `reef_stress_records`: views that return exactly the
  CSV columns in CSV order, plus `source_row`. The app and verification read these.
- `imports` (file hash and row count per file), `schema_migrations` (migration checksum).

Types follow Tiger's `design-postgres-tables` guidance: `double precision` for
measured floats, `integer` for bounded IDs, years and counts, `date` for survey
windows, `boolean NOT NULL` for flags, and `text` plus `CHECK` for the risk band.
Every CSV value round-trips exactly (verified field by field; see Verification).
The API therefore returns JSON numbers and booleans, and ISO `YYYY-MM-DD` strings
for dates (cast to text so the driver cannot shift them by time zone).

**Why ordinary tables, not hypertables.** Tiger's hypertable guidance targets
insert-heavy time series. Its candidate criteria list "Large volumes (1M+ rows),
time-based queries, infrequent updates" and treat "small static tables" as poor
candidates. Columnstore `segmentby` also needs more than 100 rows per segment
value per chunk, but these files have one row per reef per year. At about 18.5k
static annual rows, hypertables, columnstore and continuous aggregates would add
chunk overhead with no benefit. Revisit when daily observations or continuous
ingestion arrive, using the `setup-timescaledb-hypertables` guidance. No retention
policy deletes these historical records.

## Roles and access

Tiger Cloud's `tsdbadmin` is not a superuser. Least privilege follows Tiger's
read-only role pattern:

- `reef_data_read` (NOLOGIN group, created by the migration): `USAGE` on
  `reef_data` and `SELECT` on its tables and views.
- `reef_atlas_reader` (LOGIN, created by `pnpm db:reader`): a member of
  `reef_data_read` with `tsdb_admin.read_only_role = true`. This is Tiger's
  immutable read-only mode, the same setting `tiger db create role --read-only`
  applies. Sessions cannot switch it off. It also sets `statement_timeout 10s`,
  `idle_in_transaction_session_timeout 15s`, and `CONNECTION LIMIT 20`.
- These were verified live on the service: reads succeed; `INSERT`, `DELETE`,
  temporary tables, `CREATE TABLE`, `BEGIN READ WRITE` and
  `SET default_transaction_read_only = off` are all rejected by the server.
- The reader password is generated locally. Only a SCRAM-SHA-256 verifier is
  sent. The service runs with `log_statement = ddl`, and PostgreSQL warns that a
  plaintext `CREATE ROLE … PASSWORD` can end up in server logs.
- Tiger notes that a read-only role gives no resource isolation. Use a read
  replica if analytics load must never affect the primary.

## Configuration and import

Use Node 24 and `pnpm install --frozen-lockfile` in `apps/web`.

1. Put the admin URL from the downloaded credentials in the ignored file
   `.env.tiger-admin` as `TIGER_ADMIN_URL` (mode 0600). The app runtime never
   uses it. Credential downloads (`tiger-cloud-*-credentials.*`) are ignored by Git.
2. Run `pnpm db:validate`, then `pnpm db:import`, then `pnpm db:verify`.
3. Run `pnpm db:reader` once (set `TIGER_READER_ENV_FILE=.env.local` to write the
   file directly). It refuses an existing role or file, so it never rotates live
   credentials. If it fails while writing the file or committing, check the role
   and file state before you retry.
4. For production, install the reader file as `/opt/reefatlas/secrets/tiger.env`,
   owned by the deploy operator with mode 0600. Compose loads it through
   `env_file`, and `TIGER_ENV_FILE` overrides the path. If the file is missing the
   demo still boots, and the dataset API returns 503 until it is configured.

**TLS.** `database/connection.mjs` strips every `ssl*` URL parameter and always
sets `ssl.rejectUnauthorized = true`. Node-postgres documents that URL SSL
parameters replace the `ssl` object, so a pasted `?sslmode=require` could
otherwise weaken it. With the default hostname check this is equivalent to
libpq's `verify-full`. That is stricter than the `sslmode=require` in Tiger's
default connection string, as Tiger's strict-SSL guide recommends. Only set
`TIGER_CA_CERT_PATH` if a private CA is ever required, and mount it read-only
inside the container. Never disable verification.

**Pooling.** The app is a long-running Node server with one bounded `pg.Pool` per
process (`TIGER_POOL_MAX`, default 5, capped at 20), so it uses the direct
endpoint. Tiger recommends its PgBouncer pooler for many short-lived connections
(serverless and event-driven clients). If the app moves to that model, add a
pooler in Tiger Console (Operations → Connection pooling) and use the transaction
pool connection string it shows (database `tsdb_transaction`). The service has
`max_connections = 105`, so budget the sum of pools across processes and replicas.
Imports and DDL must always use the direct endpoint.

## API

`GET /api/reef-data?dataset=risk&year=2023&reef=4&page=1`

- `dataset`: `risk` (default) or `stress`.
- `year`: optional, limited to the dataset's period.
- `reef`: optional positive integer source reef ID.
- `page`: 1–1000. Page size is fixed at 50, in stable order year/reef/source_row.
- Invalid, repeated and unknown filters return 400. Database failures return a
  generic 503 (`no-store`, `Retry-After: 30`) with no connection details and no
  mock data.
- Successful responses can be cached 60 s by browsers and 300 s by a shared
  cache. All values are parameterized. Table, view and column names come only
  from the fixed allowlist.

## Production checklist (Tiger Cloud Console)

- **IP allow list:** attach an allow list limited to the Vultr host's egress IP
  plus developer IPs. It is not enabled by this change.
- **Backups and HA:** confirm the backup/PITR retention on the plan and rehearse
  a restore. Check the service's HA replica setting in Console (Tiger fails over
  to an HA replica within about 30 s). This change enables nothing paid.
- **Monitoring:** watch connections against `max_connections`, CPU and memory
  (the service is 0.5 CPU / 2 GB), storage, and slow queries.
- `/api/health` checks process liveness only. Monitor `/api/reef-data?reef=4`
  separately for dataset readiness, so a database outage never triggers a
  container restart loop.
- **Agents:** the Tiger CLI/MCP is configured `read_only = prod`. Tag the
  production service `PROD` to put agent sessions in read-only mode.

## Verification (run 2026-09-26 against `db-49612`)

- `pnpm test:db`, `pnpm db:validate`, `pnpm typecheck`, `pnpm lint`, `pnpm build`
  all pass.
- `pnpm db:import` committed 13,245 + 5,294 rows and 2,720 reefs. A second run
  added nothing. `pnpm db:verify` compares each view against a fresh COPY of the
  CSV bytes in both directions (`EXCEPT ALL`).
- An independent JavaScript parse of both CSVs matched all 203,909 fields returned
  by the database exactly: numbers as float64, empty strings as NULL, and
  `True`/`False` as booleans.
- The standalone production server served `/api/reef-data` and `/data` from Tiger
  as `reef_atlas_reader`. The client bundle contains no host, role or password.

## Official sources researched 2026-09-26

- [Tiger Cloud: read-only roles](https://www.tigerdata.com/docs/deploy/tiger-cloud/tiger-cloud-aws/security/read-only-role)
- [Tiger CLI reference: `tiger db create role --read-only`](https://www.tigerdata.com/docs/reference/tiger-cloud/tiger-cli)
- [Tiger: best practices for AI agents (read-only mode)](https://www.tigerdata.com/docs/build/tiger-cli-mcp/agent-best-practices#restrict-agents-to-read-only)
- [Tiger Cloud: connect with a stricter SSL mode](https://www.tigerdata.com/docs/deploy/tiger-cloud/tiger-cloud-aws/security/strict-ssl)
- [Tiger Cloud: connection pooling](https://www.tigerdata.com/docs/deploy/tiger-cloud/tiger-cloud-aws/service-management/connection-pooling)
- [Tiger Cloud: IP allow list](https://www.tigerdata.com/docs/deploy/tiger-cloud/tiger-cloud-aws/security/ip-allow-list)
- [Tiger Cloud: high availability](https://www.tigerdata.com/docs/deploy/tiger-cloud/tiger-cloud-aws/high-availability/high-availability)
- [Tiger: import CSV (COPY for small datasets)](https://www.tigerdata.com/docs/deploy/mst/ingest-data#bulk-upload-from-csv-files)
- [Tiger: hypertables](https://www.tigerdata.com/docs/learn/hypertables/understand-hypertables)
- Tiger MCP skills: `design-postgres-tables`, `find-hypertable-candidates`, `setup-timescaledb-hypertables`
- [PostgreSQL 18 COPY (HEADER MATCH, line endings, NULL)](https://www.postgresql.org/docs/18/sql-copy.html)
- [PostgreSQL 18 CREATE ROLE (pre-encrypted SCRAM passwords, logging caution)](https://www.postgresql.org/docs/18/sql-createrole.html)
- [node-postgres SSL (URL parameters override the `ssl` object)](https://node-postgres.com/features/ssl)
- [node-postgres Pool API](https://node-postgres.com/apis/pool) and [pool sizing](https://node-postgres.com/guides/pool-sizing)
- [pg-copy-streams](https://github.com/brianc/node-pg-copy-streams)
- Next.js 16.3.6 bundled docs (`node_modules/next/dist/docs/01-app/`): data security, `server-only`, `serverExternalPackages` (includes `pg` by default)
