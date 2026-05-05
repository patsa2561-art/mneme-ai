/**
 * `stack-trace` — given an error / stack trace, find the commits that
 * touched each frame and any past incidents at the same locations.
 *
 * Why this exists: when a prod bug fires, the most useful question is
 * "have we seen this here before?" Mneme already indexes git + incidents.
 * Parsing a stack trace and querying both is a small composition of pieces
 * we already have.
 *
 * Supported formats (frame parser):
 *   - JS/TS:  "    at functionName (path/to/file.ts:42:15)"
 *   - Python: "  File "path/to/file.py", line 42, in functionName"
 *   - Go:     "goroutine 1 [running]: ... path/to/file.go:42 +0x..."
 *   - Java:   "    at com.example.Foo.bar(Foo.java:42)"
 *
 * Pure parsing — no I/O. Composing with retrieval lives in the CLI command.
 */

export interface StackFrame {
  /** File path as it appears in the trace. May be absolute, relative, or module-qualified. */
  file: string;
  /** Line number where the frame is. 0 when absent. */
  line: number;
  /** Function/method name when extractable; may be empty. */
  function?: string;
  /** Programming language detected from the frame format. */
  language: "js" | "python" | "go" | "java" | "unknown";
}

const PATTERNS: Array<{ language: StackFrame["language"]; re: RegExp; map: (m: RegExpExecArray) => StackFrame | null }> = [
  // JS/TS — V8 / Node.js / browser
  // "    at functionName (path/to/file.ts:42:15)"
  // "    at path/to/file.ts:42:15"
  {
    language: "js",
    re: /\bat\s+(?:(?<fn>[\w$.<>[\]\s]+?)\s+\()?(?<file>[^():\n]+\.[a-zA-Z]+):(?<line>\d+)(?::\d+)?\)?/g,
    map: (m) => {
      const file = m.groups?.file?.trim();
      if (!file) return null;
      return {
        file,
        line: Number(m.groups?.line ?? 0),
        function: m.groups?.fn?.trim() || undefined,
        language: "js",
      };
    },
  },
  // Python — CPython tracebacks
  // '  File "path/to/file.py", line 42, in functionName'
  {
    language: "python",
    re: /File\s+"(?<file>[^"]+\.py[i]?)",\s+line\s+(?<line>\d+)(?:,\s+in\s+(?<fn>\w+))?/g,
    map: (m) => ({
      file: m.groups!.file!,
      line: Number(m.groups!.line!),
      function: m.groups?.fn || undefined,
      language: "python",
    }),
  },
  // Go — runtime panic format
  // "    /home/x/main.go:42 +0x..."
  // "main.foo(0x0, 0x0)"
  // "    /home/x/foo.go:42"
  {
    language: "go",
    re: /(?<file>[^\s():]+\.go):(?<line>\d+)/g,
    map: (m) => ({
      file: m.groups!.file!,
      line: Number(m.groups!.line!),
      language: "go",
    }),
  },
  // Java
  // "    at com.example.Foo.bar(Foo.java:42)"
  {
    language: "java",
    re: /\bat\s+(?<fn>[\w.$]+)\((?<file>[^()]+\.java):(?<line>\d+)\)/g,
    map: (m) => ({
      file: m.groups!.file!,
      line: Number(m.groups!.line!),
      function: m.groups?.fn || undefined,
      language: "java",
    }),
  },
];

/**
 * Parse a multi-line stack trace into ordered frames. Frames are deduped
 * when the same (file, line) appears consecutively. Languages that share
 * patterns (e.g. .ts files might also match the python file regex if
 * weirdly formatted) are disambiguated by extension first.
 */
export function parseStackTrace(text: string): StackFrame[] {
  if (!text || !text.trim()) return [];
  const seen = new Set<string>();
  const frames: StackFrame[] = [];

  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const frame = p.map(m);
      if (!frame) continue;
      // Skip language-mismatch (e.g. js regex matching a Java line).
      const ext = frame.file.split(".").pop()?.toLowerCase();
      if (frame.language === "js" && ext && !["js", "ts", "jsx", "tsx", "mjs", "cjs"].includes(ext)) continue;
      const key = `${frame.file}:${frame.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      frames.push(frame);
    }
  }

  // Sort by appearance order in original text (so most-recent-frame-first
  // for languages where the trace is bottom-up like Python).
  // Detection: count file paths — the first frame in the input is what we keep first.
  return frames.sort((a, b) => text.indexOf(a.file) - text.indexOf(b.file));
}

/**
 * Heuristic: detect whether the trace appears to be from a particular
 * language. Useful when displaying frame analysis ("Python traceback").
 */
export function detectLanguage(text: string): StackFrame["language"] {
  const t = text.toLowerCase();
  if (t.includes("traceback") || t.includes('file "') || t.includes(".py"))
    return t.includes(".py") ? "python" : "unknown";
  if (t.includes("goroutine") || /\.go:\d+/.test(t)) return "go";
  if (/\.java:\d+/.test(t)) return "java";
  if (/\b(typeerror|referenceerror|syntaxerror|rangeerror)\b/.test(t)) return "js";
  if (/\.[jt]sx?:\d+/.test(t)) return "js";
  return "unknown";
}
