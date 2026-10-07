import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface EditableFile {
  path: string;
  content: string;
  revision: string;
}

function permittedFile(filename: unknown, roots: string[]): string {
  if (typeof filename !== "string" || !path.isAbsolute(filename))
    throw new Error("无效文件路径");
  const resolved = fs.realpathSync(filename);
  if (!fs.statSync(resolved).isFile()) throw new Error("只能编辑普通文件");
  const withinRoot = roots.some((folder) => {
    try {
      const relative = path.relative(fs.realpathSync(folder), resolved);
      return (
        relative !== "" &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      );
    } catch {
      return false;
    }
  });
  if (!withinRoot) throw new Error("请先将文件所属目录添加为项目或收藏夹");
  return resolved;
}

function revision(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readEditableFile(
  filename: unknown,
  roots: string[],
): EditableFile {
  const file = permittedFile(filename, roots);
  if (fs.statSync(file).size > MAX_FILE_BYTES)
    throw new Error("文件超过 2 MB，请在 VS Code 中打开");
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0))
    throw new Error("暂不支持二进制或大于 2 MB 的文件");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error("暂只支持 UTF-8 文本文件，请在 VS Code 中打开");
  }
  return { path: file, content, revision: revision(bytes) };
}

export function saveEditableFile(
  filename: unknown,
  content: unknown,
  expectedRevision: unknown,
  roots: string[],
): EditableFile {
  if (
    typeof content !== "string" ||
    typeof expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedRevision)
  )
    throw new Error("无效保存请求");
  const file = permittedFile(filename, roots);
  const next = Buffer.from(content, "utf8");
  if (next.length > MAX_FILE_BYTES)
    throw new Error("文件超过 2 MB，请在 VS Code 中编辑");
  const current = fs.readFileSync(file);
  if (revision(current) !== expectedRevision)
    throw new Error(
      "磁盘上的文件已被其他程序修改。请先检查差异，避免覆盖新内容。",
    );
  fs.writeFileSync(file, next);
  return { path: file, content, revision: revision(next) };
}
