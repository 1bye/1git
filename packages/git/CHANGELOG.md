# @1git/git

## 0.0.1

### Patch Changes

- 37e9b88: Review diverged branches with header confirmation popups and return directly to Changes after integration. Compare either conflict source with the working result in an aligned split diff, with highlighted hunks, expandable context, and clearer file groups and operation status. Reject choosing an indexed version that changed after review. Push remains a separate action.
- 41d4d2d: Fix Git pushes failing when pre-push hooks run Oxlint or other native Node.js tools.
