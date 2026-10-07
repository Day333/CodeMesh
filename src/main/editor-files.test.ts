import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readEditableFile, saveEditableFile } from "./editor-files";

let root: string;
let file: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(process.cwd(), ".codemesh-editor-test-"));
  file = path.join(root, "sample.ts");
  fs.writeFileSync(file, "const answer = 1;\r\n", "utf8");
});
afterEach(() => {
  if (
    root &&
    path.dirname(root) === process.cwd() &&
    path.basename(root).startsWith(".codemesh-editor-test-")
  )
    fs.rmSync(root, { recursive: true, force: true });
});

it("reads and saves a UTF-8 file inside an approved folder", () => {
  const opened = readEditableFile(file, [root]);
  expect(opened.content).toBe("const answer = 1;\r\n");
  const saved = saveEditableFile(
    file,
    "const answer = 2;\r\n",
    opened.revision,
    [root],
  );
  expect(fs.readFileSync(file, "utf8")).toBe(saved.content);
  expect(saved.revision).not.toBe(opened.revision);
});

it("refuses an unapproved folder and external changes", () => {
  expect(() => readEditableFile(file, [])).toThrow("添加为项目或收藏夹");
  const opened = readEditableFile(file, [root]);
  fs.writeFileSync(file, "changed elsewhere", "utf8");
  expect(() =>
    saveEditableFile(file, "my changes", opened.revision, [root]),
  ).toThrow("其他程序修改");
  expect(fs.readFileSync(file, "utf8")).toBe("changed elsewhere");
});

it("rejects binary files", () => {
  fs.writeFileSync(file, Buffer.from([0, 1, 2]));
  expect(() => readEditableFile(file, [root])).toThrow("二进制");
});

it("preserves a UTF-8 byte-order mark when saving", () => {
  fs.writeFileSync(file, Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
  const opened = readEditableFile(file, [root]);
  expect(opened.content).toBe("\ufeffa");
  saveEditableFile(file, `${opened.content}b`, opened.revision, [root]);
  expect(fs.readFileSync(file).subarray(0, 3)).toEqual(
    Buffer.from([0xef, 0xbb, 0xbf]),
  );
});
