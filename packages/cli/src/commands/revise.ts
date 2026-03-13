import { Command } from "commander";
import { PipelineRunner, type ReviseMode } from "@actalk/inkos-core";
import { loadConfig, createClient, findProjectRoot, log, logError } from "../utils.js";

export const reviseCommand = new Command("revise")
  .description("Revise a chapter based on audit issues")
  .argument("<book-id>", "Book ID")
  .argument("[chapter]", "Chapter number (defaults to latest)")
  .option("--mode <mode>", "Revise mode: polish, rewrite, rework", "rewrite")
  .option("--json", "Output JSON")
  .action(async (bookId: string, chapterStr: string | undefined, opts) => {
    try {
      const config = await loadConfig();
      const client = createClient(config);
      const root = findProjectRoot();

      const pipeline = new PipelineRunner({
        client,
        model: config.llm.model,
        projectRoot: root,
      });

      const chapterNumber = chapterStr ? parseInt(chapterStr, 10) : undefined;
      const mode = opts.mode as ReviseMode;
      if (!opts.json) log(`Revising "${bookId}"${chapterNumber ? ` chapter ${chapterNumber}` : " (latest)"} [mode: ${mode}]...`);

      const result = await pipeline.reviseDraft(bookId, chapterNumber, mode);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`  Chapter ${result.chapterNumber} revised`);
        log(`  Words: ${result.wordCount}`);
        if (result.fixedIssues.length > 0) {
          log("  Fixed:");
          for (const fix of result.fixedIssues) {
            log(`    - ${fix}`);
          }
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Revise failed: ${e}`);
      }
      process.exit(1);
    }
  });
