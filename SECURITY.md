# Security policy

1git is beta software. Security fixes target the latest release; older versions
do not have a separate maintenance branch. Keep Git and macOS up to date too.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on the
[GitHub repository](https://github.com/1bye/1git/security) when private reporting
is available. Include affected versions, reproduction steps using disposable
repositories, and the potential impact. Do not include real credentials or
private repository contents.

If private reporting is unavailable, open an issue asking for a private contact
without posting the vulnerability details. Do not disclose an exploit in a
public issue or pull request before coordinating a fix.

Ordinary bugs and feature requests belong in
[GitHub Issues](https://github.com/1bye/1git/issues). There is no guaranteed
response time or paid bug bounty.

## Sensitive data

Do not commit or attach hosting tokens, AI keys, SSH keys, Keychain exports,
signing private keys, release environment files, or Alchemy credentials/state.
If a credential is exposed, revoke or rotate it; deleting the current file does
not remove it from Git history. Public verification keys and the public signing
certificate pin are intentionally part of the source tree.
