import assert from "node:assert/strict";
import { inferGetNoteDocumentType } from "../apps/api/src/services/getnote-connector.js";

assert.equal(inferGetNoteDocumentType({ transcript: "这是一段已经转写完成的客户访谈。" }), "transcript");
assert.equal(inferGetNoteDocumentType({ noteType: "recorder", noteContent: "正文放在 note.content" }), "transcript");
assert.equal(inferGetNoteDocumentType({ noteContent: "### 录音信息\n录音时间：2026-08-11\n正文内容" }), "transcript");
assert.equal(inferGetNoteDocumentType({ noteContent: "参与人数：2人\n这是客户访谈正文" }), "transcript");
assert.equal(inferGetNoteDocumentType({ webPageContent: "普通网页文章" }), "web_page");
assert.equal(inferGetNoteDocumentType({ noteContent: "普通手写笔记" }), "note");

console.log("GetNote transcript classification smoke passed.");
