/**
 * A small, dependency-free parser for the Prometheus text exposition format.
 * Handles `# HELP` / `# TYPE` comments, labelled samples with escaped label
 * values, and the special float values `+Inf`, `-Inf`, `NaN`.
 *
 * https://prometheus.io/docs/instrumenting/exposition_formats/
 */

export interface PromSample {
  labels: Record<string, string>;
  value: number;
}

export interface PromFamily {
  name: string;
  type: string | null;
  help: string | null;
  samples: PromSample[];
}

export interface ParseResult {
  families: PromFamily[];
  /** Total number of samples parsed (may exceed the samples kept per family). */
  sampleCount: number;
}

function parseValue(token: string): number {
  switch (token) {
    case "+Inf":
      return Number.POSITIVE_INFINITY;
    case "-Inf":
      return Number.NEGATIVE_INFINITY;
    case "NaN":
      return Number.NaN;
    default: {
      const n = Number(token);
      return Number.isNaN(n) ? Number.NaN : n;
    }
  }
}

const LABEL_RE = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;

function parseLabels(inner: string): Record<string, string> {
  const labels: Record<string, string> = {};
  let m: RegExpExecArray | null;
  LABEL_RE.lastIndex = 0;
  while ((m = LABEL_RE.exec(inner)) !== null) {
    labels[m[1]] = m[2]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  }
  return labels;
}

/**
 * Parse a metrics document. `maxSamplesPerFamily` caps how many samples are
 * retained per family to keep the payload sent to the browser bounded; the true
 * total is still reported via `sampleCount`.
 */
export function parsePrometheus(
  text: string,
  maxSamplesPerFamily = 50,
): ParseResult {
  const families = new Map<string, PromFamily>();
  let sampleCount = 0;

  function family(name: string): PromFamily {
    let f = families.get(name);
    if (!f) {
      f = { name, type: null, help: null, samples: [] };
      families.set(name, f);
    }
    return f;
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;

    if (line.startsWith("#")) {
      // # HELP <name> <text>   or   # TYPE <name> <type>
      const help = /^#\s+HELP\s+(\S+)\s+(.*)$/.exec(line);
      if (help) {
        family(help[1]).help = help[2];
        continue;
      }
      const type = /^#\s+TYPE\s+(\S+)\s+(\S+)/.exec(line);
      if (type) {
        family(type[1]).type = type[2];
      }
      continue;
    }

    // <name>[{labels}] <value> [timestamp]
    let name: string;
    let labels: Record<string, string> = {};
    let rest: string;

    const brace = line.indexOf("{");
    if (brace !== -1) {
      name = line.slice(0, brace);
      const close = line.lastIndexOf("}");
      if (close === -1) continue; // malformed
      labels = parseLabels(line.slice(brace + 1, close));
      rest = line.slice(close + 1).trim();
    } else {
      const sp = line.indexOf(" ");
      if (sp === -1) continue;
      name = line.slice(0, sp);
      rest = line.slice(sp + 1).trim();
    }

    // A histogram/summary emits `metric_bucket`, `metric_sum`, etc.; group them
    // under the emitted series name so nothing is silently dropped.
    const valueToken = rest.split(/\s+/)[0];
    if (valueToken === undefined) continue;

    sampleCount++;
    const f = family(name);
    if (f.samples.length < maxSamplesPerFamily) {
      f.samples.push({ labels, value: parseValue(valueToken) });
    }
  }

  return { families: [...families.values()], sampleCount };
}
