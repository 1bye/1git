//! Reference scope classification adapted from GPUIX (Apache-2.0) and Comet (MIT).
//! See onegit-ui/THIRD_PARTY_NOTICES.md for source attribution and licenses.
use std::{path::Path, sync::OnceLock};
use syntect::parsing::{ScopeStack, SyntaxReference, SyntaxSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum LanguageId {
    Rust,
    JavaScript,
    Jsx,
    TypeScript,
    Tsx,
    Python,
    Go,
    Json,
    Jsonc,
    Bash,
    Toml,
    Markdown,
    Html,
    Css,
    Yaml,
    C,
}

/// A capture class. One per theme colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum HighlightKind {
    Comment,
    Keyword,
    String,
    StringSpecial,
    Escape,
    Number,
    Boolean,
    Type,
    TypeBuiltin,
    Constructor,
    Function,
    FunctionBuiltin,
    Macro,
    Property,
    Constant,
    Variable,
    VariableSpecial,
    Parameter,
    Operator,
    Punctuation,
    Tag,
    Attribute,
    Label,
    Embedded,
    Invalid,
}

impl HighlightKind {
    /// Stable precedence used to resolve overlapping parser captures.
    /// Without it, nested captures resolve by iteration order and a string
    /// inside a macro flickers between two colours across parses.
    const fn precedence(self) -> u8 {
        match self {
            Self::Invalid => 100,
            Self::Escape => 95,
            Self::Macro => 90,
            Self::Property | Self::Attribute => 85,
            Self::FunctionBuiltin | Self::TypeBuiltin | Self::VariableSpecial => 80,
            Self::StringSpecial | Self::Constructor | Self::Parameter => 75,
            Self::Function | Self::Type | Self::Constant | Self::Tag | Self::Label => 70,
            Self::Comment | Self::Keyword | Self::String | Self::Number | Self::Boolean => 60,
            Self::Variable | Self::Operator => 50,
            Self::Punctuation | Self::Embedded => 40,
        }
    }
}

pub(super) fn syntax_set() -> &'static SyntaxSet {
    static SET: OnceLock<SyntaxSet> = OnceLock::new();

    // The reference renderer uses this pack for TSX, TypeScript and TOML too.
    SET.get_or_init(two_face::syntax::extra_newlines)
}

pub(super) fn syntax_for_language(language: LanguageId) -> Option<&'static SyntaxReference> {
    let set = syntax_set();

    let (names, extensions): (&[&str], &[&str]) = match language {
        LanguageId::Rust => (&["Rust"], &["rs"]),
        LanguageId::JavaScript => (&["JavaScript"], &["js"]),
        // two-face fancy excludes JavaScript (Babel), so JSX uses the TSX grammar.
        LanguageId::Jsx => (&["TypeScriptReact", "JavaScript"], &["jsx", "tsx"]),
        LanguageId::TypeScript => (&["TypeScript"], &["ts"]),
        LanguageId::Tsx => (&["TypeScriptReact"], &["tsx"]),
        LanguageId::Python => (&["Python"], &["py"]),
        LanguageId::Go => (&["Go"], &["go"]),
        LanguageId::Json => (&["JSON"], &["json"]),
        LanguageId::Jsonc => (&["JSON with Comments", "JSONC", "JSON"], &["jsonc", "json"]),
        LanguageId::Bash => (&["Bourne Again Shell (bash)", "Bash"], &["bash", "sh"]),
        LanguageId::Toml => (&["TOML"], &["toml"]),
        LanguageId::Markdown => (&["Markdown"], &["md"]),
        LanguageId::Html => (&["HTML"], &["html"]),
        LanguageId::Css => (&["CSS"], &["css"]),
        LanguageId::Yaml => (&["YAML"], &["yaml", "yml"]),
        LanguageId::C => (&["C"], &["c"]),
    };

    names
        .iter()
        .find_map(|name| set.find_syntax_by_name(name))
        .or_else(|| {
            extensions
                .iter()
                .find_map(|ext| set.find_syntax_by_extension(ext))
        })
}

fn kind_for_stack(stack: &ScopeStack) -> Option<HighlightKind> {
    let mut best = None;

    for scope in stack.as_slice() {
        let Some(kind) = kind_for_scope_name(&scope.build_string()) else {
            continue;
        };

        if best.is_none_or(|prev: HighlightKind| kind.precedence() >= prev.precedence()) {
            best = Some(kind);
        }
    }

    best
}

fn stack_has_prefix(stack: &ScopeStack, prefix: &str) -> bool {
    stack
        .as_slice()
        .iter()
        .any(|scope| scope_matches(&scope.build_string(), prefix))
}

fn is_boolean_literal(text: &str) -> bool {
    matches!(
        text.trim(),
        "true" | "false" | "True" | "False" | "TRUE" | "FALSE" | "yes" | "no" | "on" | "off"
    )
}

fn is_builtin_type(language: LanguageId, text: &str) -> bool {
    let text = text.trim();

    match language {
        LanguageId::C => matches!(
            text,
            "int"
                | "void"
                | "char"
                | "unsigned"
                | "signed"
                | "long"
                | "short"
                | "float"
                | "double"
                | "_Bool"
                | "bool"
                | "size_t"
                | "ssize_t"
                | "int8_t"
                | "int16_t"
                | "int32_t"
                | "int64_t"
                | "uint8_t"
                | "uint16_t"
                | "uint32_t"
                | "uint64_t"
                | "uintptr_t"
                | "intptr_t"
                | "ptrdiff_t"
        ),
        LanguageId::Rust => matches!(
            text,
            "i8" | "i16"
                | "i32"
                | "i64"
                | "i128"
                | "isize"
                | "u8"
                | "u16"
                | "u32"
                | "u64"
                | "u128"
                | "usize"
                | "f32"
                | "f64"
                | "bool"
                | "char"
                | "str"
                | "Self"
        ),
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Jsx => {
            matches!(
                text,
                "string"
                    | "number"
                    | "boolean"
                    | "bigint"
                    | "symbol"
                    | "object"
                    | "undefined"
                    | "never"
                    | "unknown"
                    | "any"
                    | "void"
            )
        }
        _ => false,
    }
}

pub(super) fn kind_for_region(
    language: LanguageId,
    text: &str,
    stack: &ScopeStack,
) -> Option<HighlightKind> {
    let kind = kind_for_stack(stack)?;

    if stack_has_prefix(stack, "constant.language") {
        return Some(if is_boolean_literal(text) {
            HighlightKind::Boolean
        } else {
            HighlightKind::Constant
        });
    }

    if stack_has_prefix(stack, "storage.type") {
        return Some(if is_builtin_type(language, text) {
            match language {
                LanguageId::C => HighlightKind::Type,
                _ => HighlightKind::TypeBuiltin,
            }
        } else {
            HighlightKind::Keyword
        });
    }

    Some(kind)
}

/// Longest prefix first. `string` must not steal `string.regexp`.
const SCOPE_PREFIXES: &[(&str, HighlightKind)] = &[
    ("entity.other.attribute-name", HighlightKind::Attribute),
    ("support.type.property-name", HighlightKind::Property),
    ("constant.language.undefined", HighlightKind::Constant),
    ("entity.name.function.macro", HighlightKind::Macro),
    ("constant.character.escape", HighlightKind::Escape),
    ("constant.language.boolean", HighlightKind::Boolean),
    ("entity.name.constructor", HighlightKind::Constructor),
    ("meta.object-literal.key", HighlightKind::Property),
    ("support.function.builtin", HighlightKind::FunctionBuiltin),
    ("support.function.macro", HighlightKind::Macro),
    ("variable.other.property", HighlightKind::Property),
    ("variable.other.constant", HighlightKind::Constant),
    ("constant.language.none", HighlightKind::Constant),
    ("constant.language.null", HighlightKind::Constant),
    ("support.class.builtin", HighlightKind::TypeBuiltin),
    ("entity.name.interface", HighlightKind::Type),
    ("entity.name.namespace", HighlightKind::Type),
    ("entity.name.function", HighlightKind::Function),
    ("variable.other.member", HighlightKind::Property),
    ("constant.language.nil", HighlightKind::Constant),
    ("string.interpolated", HighlightKind::StringSpecial),
    ("constant.character", HighlightKind::Escape),
    ("entity.name.section", HighlightKind::Label),
    ("variable.parameter", HighlightKind::Parameter),
    ("constant.language", HighlightKind::Boolean),
    ("entity.name.struct", HighlightKind::Type),
    ("variable.language", HighlightKind::VariableSpecial),
    ("constant.numeric", HighlightKind::Number),
    ("entity.name.class", HighlightKind::Type),
    ("entity.name.label", HighlightKind::Label),
    ("entity.name.macro", HighlightKind::Macro),
    ("entity.name.trait", HighlightKind::Type),
    ("keyword.operator", HighlightKind::Operator),
    ("meta.mapping.key", HighlightKind::Property),
    ("storage.modifier", HighlightKind::Keyword),
    ("string.quoted.other", HighlightKind::StringSpecial),
    ("support.constant", HighlightKind::Constant),
    ("support.function", HighlightKind::FunctionBuiltin),
    ("constant.other", HighlightKind::Constant),
    ("entity.name.enum", HighlightKind::Type),
    ("entity.name.tag", HighlightKind::Tag),
    ("entity.name.type", HighlightKind::Type),
    ("keyword.control", HighlightKind::Keyword),
    ("string.unquoted", HighlightKind::StringSpecial),
    ("meta.embedded", HighlightKind::Embedded),
    ("string.escape", HighlightKind::Escape),
    ("string.regexp", HighlightKind::StringSpecial),
    ("support.class", HighlightKind::TypeBuiltin),
    ("support.macro", HighlightKind::Macro),
    ("storage.type", HighlightKind::Keyword),
    ("support.type", HighlightKind::TypeBuiltin),
    ("punctuation", HighlightKind::Punctuation),
    ("constructor", HighlightKind::Constructor),
    ("variable", HighlightKind::Variable),
    ("function", HighlightKind::Function),
    ("operator", HighlightKind::Operator),
    ("property", HighlightKind::Property),
    ("constant", HighlightKind::Constant),
    ("keyword", HighlightKind::Keyword),
    ("storage", HighlightKind::Keyword),
    ("boolean", HighlightKind::Boolean),
    ("comment", HighlightKind::Comment),
    ("invalid", HighlightKind::Invalid),
    ("string", HighlightKind::String),
    ("markup", HighlightKind::Embedded),
    ("number", HighlightKind::Number),
    ("label", HighlightKind::Label),
    ("type", HighlightKind::Type),
];

fn scope_matches(name: &str, prefix: &str) -> bool {
    name == prefix
        || (name.len() > prefix.len()
            && name.starts_with(prefix)
            && name.as_bytes()[prefix.len()] == b'.')
}

/// Map a TextMate scope name onto the nearest [`HighlightKind`].
/// Language prefixes such as `source.rust` are ignored.
pub(super) fn kind_for_scope_name(name: &str) -> Option<HighlightKind> {
    SCOPE_PREFIXES
        .iter()
        .find(|(prefix, _)| scope_matches(name, prefix))
        .map(|(_, kind)| *kind)
}

/// Fence tag beats path, path beats shebang.
pub(super) fn detect_language(
    path: Option<&str>,
    fence_tag: Option<&str>,
    first_line: Option<&str>,
) -> Option<LanguageId> {
    fence_tag
        .and_then(language_for_alias)
        .or_else(|| path.and_then(language_for_path))
        .or_else(|| first_line.and_then(language_for_shebang))
}

pub(super) fn language_for_alias(alias: &str) -> Option<LanguageId> {
    let alias = alias
        .trim()
        .split_ascii_whitespace()
        .next()?
        .to_ascii_lowercase();

    Some(match alias.as_str() {
        "rust" | "rs" => LanguageId::Rust,
        "javascript" | "js" | "mjs" | "cjs" => LanguageId::JavaScript,
        "jsx" => LanguageId::Jsx,
        "typescript" | "ts" | "mts" | "cts" => LanguageId::TypeScript,
        "tsx" => LanguageId::Tsx,
        "python" | "py" | "python3" => LanguageId::Python,
        "go" | "golang" => LanguageId::Go,
        "json" => LanguageId::Json,
        "jsonc" => LanguageId::Jsonc,
        "bash" | "sh" | "shell" | "zsh" | "console" => LanguageId::Bash,
        "toml" => LanguageId::Toml,
        "markdown" | "md" => LanguageId::Markdown,
        "html" | "htm" => LanguageId::Html,
        "css" => LanguageId::Css,
        "yaml" | "yml" => LanguageId::Yaml,
        "c" | "h" => LanguageId::C,
        _ => return None,
    })
}

pub(super) fn language_for_path(path: &str) -> Option<LanguageId> {
    let path = Path::new(path);
    let name = path.file_name()?.to_str()?;

    match name.to_ascii_lowercase().as_str() {
        "cargo.lock" | "cargo.toml" | "pyproject.toml" => return Some(LanguageId::Toml),
        _ => {}
    }

    language_for_alias(path.extension()?.to_str()?)
}

fn language_for_shebang(line: &str) -> Option<LanguageId> {
    let line = line.strip_prefix("#!")?.to_ascii_lowercase();

    if line.contains("python") {
        Some(LanguageId::Python)
    } else if line.contains("node") {
        Some(LanguageId::JavaScript)
    } else if ["bash", "zsh", "/sh", " sh"]
        .iter()
        .any(|name| line.contains(name))
    {
        Some(LanguageId::Bash)
    } else {
        None
    }
}
