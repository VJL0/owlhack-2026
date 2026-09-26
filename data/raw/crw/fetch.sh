#!/bin/sh
id=$1; lat=$2; lon=$3
T="%5B(2016-01-03T12:00:00Z):7:(2024-12-29T12:00:00Z)%5D%5B($lat)%5D%5B($lon)%5D"
curl -sL --retry 3 --max-time 400 "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.csv?CRW_DHW$T,CRW_SST$T,CRW_SSTANOMALY$T,CRW_BAA$T" -o "$id.csv"
echo "$id $(wc -l < $id.csv) lines"
