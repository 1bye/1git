//! Patch fixtures prepared once, independent of Git and render frequency.
use onegit_ui::DiffDocument;

pub const LABELS: [&str; 5] = [
    "Rust changes",
    "Unicode & newlines",
    "Large patch",
    "Binary change",
    "No changes",
];

fn parse(patch: &str) -> DiffDocument {
    DiffDocument::parse(patch).expect("valid gallery patch")
}

pub fn samples() -> Vec<DiffDocument> {
    let mut large = String::from("@@ -1,5000 +1,5000 @@\n");

    for index in 1..=5000 {
        large.push_str(&format!(
            "-let row_{index} = old_value;\n+let row_{index} = render_with_theme(theme, \"{}\");\n",
            "long source text · ".repeat(12)
        ));
    }

    vec![
        parse(
            "diff --git a/theme.rs b/theme.rs\nindex 1234567..abcdef0 100644\n--- a/theme.rs\n+++ b/theme.rs\n@@ -12,6 +12,8 @@ fn render() {\n     let theme = Theme::current();\n-    let border = theme.line;\n-    draw_border(border);\n+    let surface = theme.surface;\n+    let ink = theme.ink;\n+    draw_surface(surface);\n+    draw_text(ink);\n     render_children();\n     finish_frame();\n }\n@@ -40 +42 @@\n-const OLD: bool = true;\n+const TACTILE: bool = true;\n",
        ),
        parse(
            "--- a/日本語.rs\n+++ b/日本語.rs\n@@ -1,3 +1,3 @@\n fn greeting() {\n-\tlet text = \"Hello\";\r\n+\tlet text = \"こんにちは · café 👋\";\r\n }\n\\ No newline at end of file\n",
        ),
        parse(&large),
        parse(
            "diff --git a/icon.png b/icon.png\nindex 1234567..abcdef0 100644\nBinary files a/icon.png and b/icon.png differ\n",
        ),
        parse(""),
    ]
}

pub fn repository() -> Vec<DiffDocument> {
    [
        "@@ -12,3 +12,4 @@ fn render() {\n     let theme = Theme::current();\n-    surface: charcoal,\n+    surface: theme.surface,\n+    ink: theme.ink,\n }\n",
        "@@ -18,3 +18,3 @@ Button {\n     variant: Secondary,\n-    border: visible,\n+    border: none,\n }\n",
        "@@ -1 +1,2 @@\n-A component gallery.\n+A reusable repository workspace.\n+Built with native controls.\n",
    ].into_iter().map(parse).collect()
}
