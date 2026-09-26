"use client";

import { AnimatePresence, motion } from "motion/react";
import { SPRING } from "@/lib/ui";

export default function Caption({ id, text, note }: { id: string; text: string; note?: string }) {
  return (
    <div aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.p
          key={id}
          className="caption"
          initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          // A quick exit, because mode="wait" holds the next caption until this one leaves
          exit={{ opacity: 0, y: -4, filter: "blur(4px)", transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] } }}
          transition={SPRING}
        >
          {text}
          {note && <small>{note}</small>}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
