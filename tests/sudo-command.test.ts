import { describe, expect, it } from 'vitest';
import {
  isSudoAuthFailure,
  planSudoCommand,
  sanitizeSudoOutput,
  SUDO_AUTH_FAILURE_TEXT,
  SUDO_REFUSAL_TEXT,
  SUDO_RETRY_TEXT,
} from '../src/main/agent/sudo-command';

describe('planSudoCommand: the command is left alone', () => {
  it('ignores the keyword inside a quoted argument (the bug that started this)', () => {
    expect(planSudoCommand('grep -rn "sudo-password" src/').disposition).toBe('none');
  });

  it('ignores the keyword inside a plain quoted string', () => {
    expect(planSudoCommand('echo "run sudo later"').disposition).toBe('none');
  });

  it('ignores a credential-shaped mention inside quotes', () => {
    expect(planSudoCommand('echo "run sudo -S later"').disposition).toBe('none');
    expect(planSudoCommand('grep -rn "| sudo" src/').disposition).toBe('none');
    expect(planSudoCommand('grep -rn "sudo -S" src/').disposition).toBe('none');
  });

  it('ignores the keyword in a comment', () => {
    expect(planSudoCommand('ls # sudo rm -rf /').disposition).toBe('none');
    expect(planSudoCommand('ls # run sudo -S later').disposition).toBe('none');
  });

  it('ignores a quoted command word', () => {
    expect(planSudoCommand('"sudo" ls').disposition).toBe('none');
  });

  it('leaves commands without the keyword alone', () => {
    expect(planSudoCommand('ls -la /tmp').disposition).toBe('none');
    expect(planSudoCommand('curl https://example.com/#fragment').disposition).toBe('none');
  });
});

describe('planSudoCommand: invocations that cannot consume a password', () => {
  it('passes non-interactive and no-password invocations through untouched', () => {
    for (const command of [
      'sudo -n true',
      'sudo -nv true',
      'sudo --non-interactive true',
      'sudo -u root -n id',
      'sudo -k',
      'sudo -K',
      'sudo -k -K',
      'sudo -l',
      'sudo --list',
      'sudo',
    ]) {
      const plan = planSudoCommand(command);
      expect(plan.disposition).toBe('passthrough');
      expect(plan.command).toBe(command);
    }
  });
});

describe('planSudoCommand: injection', () => {
  it('injects an empty prompt and -S into a plain command', () => {
    const plan = planSudoCommand('sudo rm -rf /tmp/x');
    expect(plan.disposition).toBe('inject');
    expect(plan.command).toBe("sudo -p '' -S rm -rf /tmp/x");
  });

  it('keeps sudo flags and quoting intact', () => {
    expect(planSudoCommand('sudo -u root ls').command).toBe("sudo -p '' -S -u root ls");
    expect(planSudoCommand('sudo -E ls').command).toBe("sudo -p '' -S -E ls");
    expect(planSudoCommand('sudo -- ls').command).toBe("sudo -p '' -S -- ls");
    expect(planSudoCommand('sudo -i').command).toBe("sudo -p '' -S -i");
    expect(planSudoCommand(`sudo sh -c 'echo "hi there"'`).command).toBe(
      `sudo -p '' -S sh -c 'echo "hi there"'`,
    );
  });

  it('keeps a user-supplied prompt and only adds -S', () => {
    expect(planSudoCommand("sudo -p 'Password: ' ls").command).toBe(
      "sudo -S -p 'Password: ' ls",
    );
    expect(planSudoCommand("sudo --prompt='x: ' ls").command).toBe(
      "sudo -S --prompt='x: ' ls",
    );
    expect(planSudoCommand("sudo -p'x: ' id").command).toBe("sudo -S -p'x: ' id");
  });

  it('allows redirections that do not move stdin', () => {
    expect(planSudoCommand('sudo cat /etc/hosts > /tmp/out').disposition).toBe('inject');
    expect(planSudoCommand('sudo id 2>&1').command).toBe("sudo -p '' -S id 2>&1");
    expect(planSudoCommand('sudo id &> /tmp/x').disposition).toBe('inject');
    expect(planSudoCommand('sudo id >> /tmp/log 2>&1').disposition).toBe('inject');
  });

  it('allows separators and quotes that are only data', () => {
    expect(planSudoCommand(`sudo sh -c 'a; b'`).command).toBe(
      `sudo -p '' -S sh -c 'a; b'`,
    );
    expect(planSudoCommand('sudo grep -n "a|b" /etc/hosts').disposition).toBe('inject');
    expect(planSudoCommand('sudo grep -n "sudo -S" /etc/hosts').disposition).toBe(
      'inject',
    );
  });

  it('ignores -n that belongs to the inner command', () => {
    expect(planSudoCommand('sudo rm -n').command).toBe("sudo -p '' -S rm -n");
  });
});

describe('planSudoCommand: refusal', () => {
  it('refuses an author-supplied credential', () => {
    for (const command of [
      'sudo -S whoami',
      'sudo --stdin whoami',
      'sudo -A whoami',
      'sudo --askpass whoami',
      "printf 'x' | sudo -S tee /tmp/f",
      'echo hunter2 | sudo tee /tmp/f',
    ]) {
      const plan = planSudoCommand(command);
      expect(plan.disposition).toBe('refuse');
      expect(plan.refusal).toBe(SUDO_REFUSAL_TEXT);
      expect(plan.command).toBe(command);
    }
  });

  it('refuses sudo we cannot inject into, with instructions to reissue', () => {
    for (const command of [
      'cd /tmp && sudo id',
      'echo $(sudo id)',
      '(sudo id)',
      'FOO=1 sudo id',
      'sudo a; sudo b',
      'sudo true\nsudo id',
      'sudo -n true && sudo -n false',
      'cat <<EOF\nsudo rm -rf /tmp/x\nEOF',
      'sudo cat /etc/hosts < /tmp/in',
      'sudo tee /tmp/f <<< hello',
    ]) {
      const plan = planSudoCommand(command);
      expect(plan.disposition).toBe('refuse');
      expect(plan.refusal).toBe(SUDO_RETRY_TEXT);
      expect(plan.command).toBe(command);
    }
  });

  it('tells the model what to do instead, and never hints at guessing', () => {
    expect(SUDO_REFUSAL_TEXT).toContain('Password guessing is not allowed');
    expect(SUDO_REFUSAL_TEXT).toContain('a single plain `sudo <command>`');
    expect(SUDO_RETRY_TEXT).toContain('Password guessing is not allowed');
    expect(SUDO_RETRY_TEXT).toContain('a single plain `sudo <command>`');
  });
});

describe('sudo output handling', () => {
  it('strips sudo prompt lines so they never reach the model', () => {
    expect(sanitizeSudoOutput('[sudo] password for me: \nok\n')).toBe('ok\n');
    expect(sanitizeSudoOutput('a\n[sudo] password for me: b\n')).toBe('a\nb\n');
  });

  it('flags an authentication failure', () => {
    expect(
      isSudoAuthFailure(1, 'Sorry, try again.\nsudo: 3 incorrect password attempts'),
    ).toBe(true);
    expect(isSudoAuthFailure(1, 'sudo: no password was provided')).toBe(true);
    expect(isSudoAuthFailure(1, 'sudo: a password is required')).toBe(true);
  });

  it('does not flag command output that merely mentions these phrases', () => {
    expect(isSudoAuthFailure(1, 'Authentication failure: expected 2 args, got 3')).toBe(
      false,
    );
    expect(isSudoAuthFailure(1, 'grep: authentication failure: file not found')).toBe(
      false,
    );
    expect(isSudoAuthFailure(2, 'grep: /var/log/x: No such file or directory')).toBe(
      false,
    );
    expect(isSudoAuthFailure(0, 'Updating password policy')).toBe(false);
  });

  it('tells the model not to retry or guess', () => {
    expect(SUDO_AUTH_FAILURE_TEXT).toContain('Do not retry');
    expect(SUDO_AUTH_FAILURE_TEXT).toContain('do not guess passwords');
  });
});
