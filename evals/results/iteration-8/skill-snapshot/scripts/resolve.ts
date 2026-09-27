#!/usr/bin/env node
/**
 * Find or verify the article that represents a topic in each language edition. See HELP.
 */
import { resolveTopic } from "./lib/resolve.ts";
import { ApiError, search } from "./lib/api.ts";
import { EXIT, LANG_RE, fail, handleCli, list, parseArgs, printJson, str } from "./lib/util.ts";

const HELP = `
Usage: node scripts/resolve.ts --topic "<topic>" --langs <codes> [--source en] [--search]

Shows which article analyze.ts would use per language and how it was matched:
  langlink/high  interlanguage link from the anchor article — safe
  search/high    local search hit that links back to the anchor article — safe
  search/medium  search hit in the anchor language itself — check it is the topic
  search/low     local search hit with no link back — usually a DIFFERENT topic; do not use as-is
  none           no article found
  note "disambiguation"  the English title is a disambiguation page ("Python", "Claude"): nothing is used —
                         pick a specific title from "candidates" ("Python (programming language)")
  note "title-mismatch"  a word of the topic is missing from the anchor title ("Claude Code" → "Claude (AI)"):
                         every match is low confidence — the topic probably has no article of its own

Options:
  --source en    language of the anchor search (default: en for Latin-script topics, else the first --langs)
  --search       instead, list the top 8 search hits in every language (to pick a title for --articles)

Examples:
  node scripts/resolve.ts --topic "Intermittent fasting" --langs pl,cs
  node scripts/resolve.ts --topic "post przerywany" --langs pl --search
`;

const args = parseArgs(process.argv.slice(2));
handleCli(args, HELP, ["topic", "langs", "source", "search", "help"]);
const topic = str(args.topic, "topic") ?? fail(`--topic is required. Example: --topic "Astronomy" --langs uk`);
const langs = list(str(args.langs, "langs"));
if (!langs.length) fail("--langs is required, e.g. --langs uk,pl");
const bad = langs.filter((l) => !LANG_RE.test(l));
if (bad.length) fail(`invalid language code(s): ${bad.join(", ")}`);

try {
  if (args.search) {
    const out: Record<string, unknown> = {};
    for (const l of langs) out[l] = (await search(l, topic, 8)).map((h) => h.title);
    printJson(out);
  } else {
    printJson(await resolveTopic(topic, langs, { source: str(args.source, "source") }));
  }
} catch (e) {
  if (e instanceof ApiError) fail(e.message, EXIT.API);
  throw e;
}
