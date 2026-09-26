/**
 * Decide whether the bash wrapper may inject the user's password into a command.
 *
 * Injecting only works when sudo itself reads the stdin pipe the wrapper writes to.
 * Rather than parsing the shell, this module allows the trivially verifiable case
 * (a single, plainly written `sudo <command>`), passes through invocations that
 * cannot consume a password, and refuses everything else with instructions the
 * model can act on. Doing nothing or refusing is always safe; a wrong rewrite
 * silently corrupts the command.
 *
 * Every keyword check runs on a screened copy of the command (quoted spans,
 * comments and redirections blanked out) so that text which is only data - a
 * search pattern, prose, a log line - is never mistaken for an invocation. The
 * command handed back for execution is always the untouched original.
 */

export type SudoDisposition = "none" | "passthrough" | "inject" | "refuse";

export interface SudoPlan {
  disposition: SudoDisposition;
  /** Command to execute: byte-identical to the input unless disposition is "inject". */
  command: string;
  /** Model-facing explanation when disposition is "refuse". */
  refusal?: string;
}

export const SUDO_REFUSAL_TEXT =
  "Refused: this command supplies its own sudo credential (a -S/-A flag or a piped stdin), so the password dialog cannot apply to it. Password guessing is not allowed. Re-issue the privileged part as a single plain `sudo <command>`, or ask the user to run it manually.";

export const SUDO_RETRY_TEXT =
  "No password was injected: this command combines sudo with other shell constructs (another command, a pipe, a substitution or a heredoc), so sudo cannot prompt here. Re-issue the privileged part as a single plain `sudo <command>` - that is the only form the password dialog supports. Password guessing is not allowed.";

export const SUDO_AUTH_FAILURE_TEXT =
  "sudo rejected the password (or the account is temporarily locked), so this command did not run. Do not retry and do not guess passwords. Tell the user to run the command manually.";

const SUDO_AUTH_FAILURE_PATTERN =
  /^(?:sudo:.*(?:incorrect password|no password was provided|authentication failure|a password is required)|sorry, try again\.)/im;

const LEADING_SUDO_TOKEN = /^sudo(?:[ \t]|$)/;
/** A `sudo` that a shell would execute, i.e. one starting a command. */
const SUDO_COMMAND_WORD = /(?:^|[ \t;&|(`\n])sudo(?=[ \t]|$)/;
const SELF_CREDENTIAL =
  /(?:^|[ \t])(?:--stdin|--askpass|-S|-A|-[A-Za-z]*[SA][A-Za-z]*)(?=[ \t]|$)/;
const NON_INTERACTIVE =
  /(?:^|[ \t])(?:--non-interactive|-n|-[A-Za-z]*n[A-Za-z]*)(?=[ \t]|$)/;
/** Invocations that never authenticate: bare usage, timestamps, help, version, listing. */
const NO_PASSWORD_INVOCATION =
  /^(?:sudo[ \t]*|sudo(?:[ \t]+(?:-[A-Za-z]*[kKhVl][A-Za-z]*|--(?:list|help|version|reset-timestamp|remove-timestamp)))+[ \t]*)$/;
const HAS_PROMPT = /(?:^|[ \t])(?:-p|--prompt)(?=[ \t='":]|$)/;
// `<` and `|` can move sudo's stdin; `;`, `&`, backticks and `$(` mean we are looking
// at more than one command or a substitution. A sed command cannot start with a `>`.
const SHELL_META = /[|&;<`\n]|\$\(/;
// An author-supplied credential must be blocked even when the command does not lead
// with sudo (e.g. `printf x | sudo -S ...`).
const PASSWORD_GUESSING =
  /(?:^|[ \t])sudo\b[^\n]*?[ \t](?:--stdin|--askpass|-S|-A|-[A-Za-z]*[SA][A-Za-z]*)(?=[ \t]|$)|\|[ \t]*sudo\b/;

/** sudo options that take a separate value, so the next word is not a command. */
const VALUE_FLAGS = new Set([
  "-u",
  "--user",
  "-g",
  "--group",
  "-h",
  "--host",
  "-p",
  "--prompt",
  "-C",
  "--close-from",
  "-T",
  "--command-timeout",
  "-r",
  "--role",
  "-t",
  "--type",
  "-D",
  "--chdir",
  "-a",
  "--auth-type",
  "-c",
  "--login-class",
  "-U",
  "--other-user",
]);

function withoutQuotedSpans(text: string): string {
  return text.replace(/'(?:[^']*)'|"(?:[^"\\]|\\.)*"/g, " ");
}

function withoutComments(text: string): string {
  return text.replace(/(^|[ \t;&|(])#[^\n]*/g, "$1");
}

function withoutRedirects(text: string): string {
  return text.replace(/\d*>&\d*/g, " ").replace(/&>/g, " ");
}

/** The screened copy used for every keyword decision. */
function screen(command: string): string {
  return withoutRedirects(withoutComments(withoutQuotedSpans(command)));
}

function firstFlagRun(rest: string): string {
  const words = rest.trim().split(/[ \t]+/);
  const flags: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (!word.startsWith("-") || word === "-") break;
    flags.push(word);
    if (word === "--") break;
    if (VALUE_FLAGS.has(word)) {
      const value = words[index + 1];
      if (value && !value.startsWith("-")) index++;
    }
  }
  return flags.join(" ");
}

export function planSudoCommand(command: string): SudoPlan {
  const trimmed = command.trim();
  const screened = screen(trimmed);

  if (PASSWORD_GUESSING.test(screened)) {
    return {
      disposition: "refuse",
      command,
      refusal: SUDO_REFUSAL_TEXT,
    };
  }

  if (!LEADING_SUDO_TOKEN.test(screened)) {
    // Nothing that needs injecting: leave the command alone.
    if (!SUDO_COMMAND_WORD.test(screened)) {
      return { disposition: "none", command };
    }
    // A sudo invocation we cannot inject into (compound, substitution, heredoc):
    // running it only produces a terminal error, so tell the model what to reissue.
    return {
      disposition: "refuse",
      command,
      refusal: SUDO_RETRY_TEXT,
    };
  }

  const rest = trimmed.slice("sudo".length);
  const screenedRest = screened.slice("sudo".length);
  const flagRegion = `sudo ${firstFlagRun(screenedRest)}`.trim();

  if (SELF_CREDENTIAL.test(flagRegion)) {
    return {
      disposition: "refuse",
      command,
      refusal: SUDO_REFUSAL_TEXT,
    };
  }
  if (NO_PASSWORD_INVOCATION.test(screened)) {
    return { disposition: "passthrough", command };
  }
  if (SHELL_META.test(screened) || SUDO_COMMAND_WORD.test(screenedRest)) {
    return {
      disposition: "refuse",
      command,
      refusal: SUDO_RETRY_TEXT,
    };
  }
  if (NON_INTERACTIVE.test(flagRegion)) {
    return { disposition: "passthrough", command };
  }

  const prefix = HAS_PROMPT.test(flagRegion) ? "sudo -S" : "sudo -p '' -S";
  return {
    disposition: "inject",
    command: prefix + rest,
  };
}

/**
 * sudo writes its password prompt to stderr. With `-p ''` it writes nothing, but a
 * sudo called by a script inside the command still prints one, and that line must
 * not end up in the model-visible tool result.
 */
export function sanitizeSudoOutput(output: string): string {
  return output.replace(/\[sudo\] password for [^\n:]*:[ \t]?\n?/g, "");
}

export function isSudoAuthFailure(
  exitCode: number | null,
  output: string,
): boolean {
  return exitCode !== 0 && SUDO_AUTH_FAILURE_PATTERN.test(output);
}
