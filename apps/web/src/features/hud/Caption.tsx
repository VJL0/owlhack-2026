"use client";

import { AnimatePresence, motion } from "motion/react";

export default function Caption({ id, text, note }: { id: string; text: string; note?: string }) {
  return (
    <div aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.p
          key={id}
          className="caption"
          initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          {text}
          {note && <small>{note}</small>}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
