export interface MarkdownSection {
  headingPath: string[];
  startLine: number;
  content: string;
}

export interface MarkdownChunk {
  index: number;
  headingPath: string[];
  startLine: number;
  content: string;
}

export interface ChunkedMarkdown {
  title: string;
  chunks: MarkdownChunk[];
  skipped: number;
  oversizedSections: number;
}

interface HeadingFrame {
  level: number;
  text: string;
}

function fileTitle(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  return base.replace(/\.md$/i, "") || base;
}

function groupSections(
  sections: MarkdownSection[],
  maxChunkChars: number,
): Pick<ChunkedMarkdown, "chunks" | "skipped" | "oversizedSections"> {
  const chunks: MarkdownChunk[] = [];
  let skipped = 0;
  let oversizedSections = 0;
  let current: MarkdownSection[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const content = current
      .map((section) => section.content)
      .join("\n\n")
      .replace(/^\n+|\n+$/g, "");
    if (content.trim() === "") {
      skipped += 1;
      current = [];
      currentLength = 0;
      return;
    }
    if (current.length === 1 && currentLength > maxChunkChars) {
      oversizedSections += 1;
    }
    const first = current[0];
    chunks.push({
      index: chunks.length,
      headingPath: first.headingPath,
      startLine: first.startLine,
      content,
    });
    current = [];
    currentLength = 0;
  };

  const indexableSections = sections.filter((section) => {
    if (section.content.trim() === "") {
      skipped += 1;
      return false;
    }
    return true;
  });

  for (const section of indexableSections) {
    const sectionLength = section.content.length;
    if (current.length === 0) {
      current = [section];
      currentLength = sectionLength;
      continue;
    }
    const candidateLength = currentLength + 2 + sectionLength;
    if (candidateLength > maxChunkChars) {
      flush();
      current = [section];
      currentLength = sectionLength;
    } else {
      current.push(section);
      currentLength = candidateLength;
    }
  }
  flush();

  return { chunks, skipped, oversizedSections };
}

export function chunkMarkdown(
  source: string,
  fileName: string,
  maxChunkChars: number,
): ChunkedMarkdown {
  if (!Number.isInteger(maxChunkChars) || maxChunkChars < 1) {
    throw new Error("maxChunkChars must be a positive integer.");
  }

  const normalized = source.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const lines = normalized.split("\n");
  const sections: MarkdownSection[] = [];
  const headingStack: HeadingFrame[] = [];
  let fence: { char: string; length: number } | null = null;
  let currentHeadingPath: string[] = [];
  let currentStartLine = 1;
  let currentLines: string[] = [];
  let title = "";
  let seenH1 = false;

  const flushSection = (): void => {
    if (currentLines.length === 0 && currentHeadingPath.length === 0) return;
    sections.push({
      headingPath: currentHeadingPath,
      startLine: currentStartLine,
      content: currentLines.join("\n"),
    });
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNumber = i + 1;
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

    if (fence !== null) {
      currentLines.push(line);
      if (
        fenceMatch !== null &&
        fenceMatch[1][0] === fence.char &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ""
      ) {
        fence = null;
      }
      continue;
    }

    if (fenceMatch !== null) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      currentLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/);
    const level = headingMatch === null ? 0 : headingMatch[1].length;

    if (headingMatch !== null && level <= 3) {
      flushSection();
      const rawText = (headingMatch[2] ?? "").trim();
      const pathText = rawText || "(untitled)";
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text: pathText });
      currentHeadingPath = headingStack.map((frame) => frame.text);
      currentStartLine = lineNumber;
      currentLines = [line];
      if (level === 1 && !seenH1) {
        seenH1 = true;
        title = rawText;
      }
      continue;
    }

    currentLines.push(line);
  }

  flushSection();

  return {
    title: title || fileTitle(fileName),
    ...groupSections(sections, maxChunkChars),
  };
}
