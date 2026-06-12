import React from "react";
import { Box, Text } from "ink";
import { VERSION } from "../../version.js";

// "AWSSESH" in the toilet `pagga` half-block font (W hand-widened so it reads as
// W, not H). Two-tone: "AWS" in AWS-orange, "SESH" in a cool cyan→indigo gradient.
const ART = [
  "░█▀█░█░░░█░█▀▀░█▀▀░█▀▀░█▀▀░█░█",
  "░█▀█░█░█░█░▀▀█░▀▀█░█▀▀░▀▀█░█▀█",
  "░▀░▀░░▀▀▀░░▀▀▀░▀▀▀░▀▀▀░▀▀▀░▀░▀",
];

// Column where "SESH" begins (after A·W·S + separators). Drives the color split.
const SESH_AT = 14;
const W = Math.max(...ART.map((l) => l.length));

// Two fire bands: AWS = bright gold→orange, SESH = hotter orange→red.
const AWS_A: [number, number, number] = [0xff, 0xcc, 0x33]; // #ffcc33 gold
const AWS_B: [number, number, number] = [0xff, 0x95, 0x00]; // #ff9500 orange
const SESH_A: [number, number, number] = [0xff, 0x6a, 0x1a]; // #ff6a1a orange-red
const SESH_B: [number, number, number] = [0xe2, 0x3b, 0x2e]; // #e23b2e red

function lerp(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `#${[c(0), c(1), c(2)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function hexAt(x: number): string {
  if (x < SESH_AT) return lerp(AWS_A, AWS_B, SESH_AT > 1 ? x / (SESH_AT - 1) : 0);
  const span = W - 1 - SESH_AT;
  return lerp(SESH_A, SESH_B, span > 0 ? (x - SESH_AT) / span : 0);
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
