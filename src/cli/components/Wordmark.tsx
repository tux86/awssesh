import React from "react";
import { Box, Text } from "ink";
import { VERSION } from "../../version.js";

const ART = [
  "░█▀▀░█▀▀░█▀█░█▄█░█▀█░▀█▀░▀█▀░█▀▀",
  "░▀▀█░▀▀█░█░█░█░█░█▀█░░█░░░█░░█░░",
  "░▀▀▀░▀▀▀░▀▀▀░▀░▀░▀░▀░░▀░░▀▀▀░▀▀▀",
];
const START: [number, number, number] = [0xfd, 0xe0, 0x47]; // #fde047 yellow
const END: [number, number, number] = [0xef, 0x44, 0x44]; // #ef4444 red
const W = Math.max(...ART.map((l) => l.length));
function hexAt(x: number): string {
  const t = W > 1 ? x / (W - 1) : 0;
  const c = (i: number) => Math.round(START[i] + (END[i] - START[i]) * t);
  return `#${[c(0), c(1), c(2)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function Wordmark() {
  return (
    <Box flexDirection="column">
      {ART.map((line, i) => (
        <Text key={i}>
          {Array.from(line).map((ch, x) => (
            <Text key={x} color={hexAt(x)}>
              {ch}
            </Text>
          ))}
        </Text>
      ))}
      <Text dimColor>  v{VERSION}</Text>
    </Box>
  );
}
