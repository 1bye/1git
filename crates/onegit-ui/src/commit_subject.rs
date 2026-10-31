//! Display-only conventional commit prefixes; exact Git subjects remain authoritative.
use crate::{Appearance, Text, TextRole, Theme};
use rake::gpui::{self, prelude::*, rgb};
use regex::Regex;
use std::sync::OnceLock;

struct Subject<'a> {
    kind: String,
    scope: Option<&'a str>,
    breaking: bool,
    description: &'a str,
}

fn parse(subject: &str) -> Option<Subject<'_>> {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let captures = PATTERN
        .get_or_init(|| {
            Regex::new(r"(?i)^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?:[ \t]+(\S[^\r\n]*)$")
                .expect("conventional commit display pattern is valid")
        })
        .captures(subject)?;

    let kind = captures.get(1)?.as_str().to_ascii_lowercase();

    if !matches!(
        kind.as_str(),
        "feat"
            | "fix"
            | "refactor"
            | "perf"
            | "docs"
            | "test"
            | "build"
            | "ci"
            | "chore"
            | "style"
            | "revert"
    ) {
        return None;
    }

    Some(Subject {
        kind,
        scope: captures.get(2).map(|scope| scope.as_str()),
        breaking: captures.get(3).is_some(),
        description: captures.get(4)?.as_str(),
    })
}

/// A compact commit label using the original app's subdued conventional-prefix badges.
#[derive(Debug, IntoElement)]
pub struct CommitSubject {
    /// Stable label identity.
    pub id: gpui::ElementId,
    /// Exact, unmodified Git subject.
    pub subject: gpui::SharedString,
    /// Wrap long descriptions rather than truncating to a single line.
    pub wrap: bool,
}

impl CommitSubject {
    /// Create a single-line label; unfamiliar subjects are displayed without rewriting.
    #[must_use]
    pub fn new(id: impl Into<gpui::ElementId>, subject: impl Into<gpui::SharedString>) -> Self {
        Self {
            id: id.into(),
            subject: subject.into(),
            wrap: false,
        }
    }
}

impl RenderOnce for CommitSubject {
    fn render(self, _: &mut gpui::Window, _: &mut gpui::App) -> impl IntoElement {
        let Some(parsed) = parse(&self.subject) else {
            return rake::view!{<Text role={TextRole::Small} max_lines={if self.wrap{None}else{Some(1)}} {..Text::new(self.id,self.subject)}/>}.into_any_element();
        };

        let theme = Theme::current();
        let dark = theme.appearance == Appearance::Dark;

        let (ink, background) = match (dark, parsed.kind.as_str()) {
            (false, "feat") => (0x38664a, 0xedf4ef),
            (true, "feat") => (0x9cc5ab, 0x2b3b32),
            (false, "fix" | "revert") => (0x955053, 0xf8eeee),
            (true, "fix" | "revert") => (0xd8a3a7, 0x443034),
            (false, "refactor") => (0x705a8b, 0xf3eff7),
            (true, "refactor") => (0xbeadd8, 0x37303f),
            (false, "perf") => (0x80633d, 0xf6f1e8),
            (true, "perf") => (0xd2ba95, 0x3e372c),
            (false, "docs" | "test") => (0x496b92, 0xedf2f8),
            (true, "docs" | "test") => (0xa5bfdb, 0x2b3542),
            (false, _) => (0x606775, 0xf0f1f3),
            (true, _) => (0xb3b8c2, 0x30333a),
        };

        let label = format!("{}{}", parsed.kind, if parsed.breaking { "!" } else { "" });

        let description = parsed.scope.map_or_else(
            || parsed.description.to_owned(),
            |scope| format!("({scope}) {}", parsed.description),
        );

        rake::view!{
            <div id={self.id} aria-label={self.subject.clone()} class="flex flex-row items-start gap-1.5 min-w-0">
                <p class="text-caption font-medium rounded-[4px] px-1 py-[1px] shrink-0" style={|s|s.bg(rgb(background)).text_color(rgb(ink))}>{label}</p>
                <div class="flex-1 min-w-0"><Text role={TextRole::Small} max_lines={if self.wrap{None}else{Some(1)}} {..Text::new("description",description)}/></div>
            </div>
        }.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_original_conventional_subject_grammar_without_changing_source_text() {
        let subject = "FEAT(api:worker)!:\tkeep exact data  ";
        let parsed = parse(subject).unwrap();

        assert_eq!(parsed.kind, "feat");
        assert_eq!(parsed.scope, Some("api:worker"));
        assert!(parsed.breaking);
        assert_eq!(parsed.description, "keep exact data  ");

        for kind in [
            "feat", "fix", "refactor", "perf", "docs", "test", "build", "ci", "chore", "style",
            "revert",
        ] {
            assert!(parse(&format!("{kind}: change")).is_some());
        }

        for plain in [
            "Custom subject",
            "other: change",
            "fix(): change",
            "fix(a(b)): change",
            "fix: ",
            "fix:no space",
            "fix: two\nlines",
        ] {
            assert!(parse(plain).is_none(), "{plain:?}");
        }
    }
}
