import "dotenv/config";
import path from "node:path";
import { analyzeSelectedClipVisuals } from "../services/clip-visual-analyzer.js";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("usage: tsx clip-vision-smoke.ts <video>");
const resolved = path.resolve(sourcePath);
const results = await analyzeSelectedClipVisuals({
  segments: [{
    segmentId: "vision-smoke",
    sourceId: "source",
    startSeconds: 174.8,
    endSeconds: 180.16,
    transcript: "中国人民保险PICC人保，看着没有？",
    role: "evidence"
  }],
  sourcePaths: { source: resolved }
});
console.log(JSON.stringify(results.get("vision-smoke"), null, 2));
