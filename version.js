// The app's version, in the one place it is written.
// BUILD: +1 on every PR. The offline worker (sw.js) names its cache after it,
// which is how a browser notices there is a new version.
// VERSION: changed when a batch goes live (Run workflow): last number for
// fixes only, middle number for new features (last goes back to 0), first
// number when Overspray is out of beta.
// Help › About shows the version, and the build too on the test copy (_lab).
self.VERSION = 'v0.1.0';
self.BUILD = 260;
