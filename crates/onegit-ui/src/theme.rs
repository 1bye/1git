use rake::gpui::{self, App, ColorExt, FontWeight, Hsla, Pixels, px, rgb, rgb_to_hsla};
use rake::theme::TextToken;

/// Explicit palette selection; following system appearance belongs to the host app.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Appearance {
    /// Quiet charcoal surfaces with a restrained blue accent.
    #[default]
    Dark,
    /// Neutral light surfaces with a blue accent.
    Light,
}

impl Appearance {
    /// The other supported palette.
    #[must_use]
    pub const fn toggled(self) -> Self {
        match self {
            Self::Dark => Self::Light,
            Self::Light => Self::Dark,
        }
    }
}

/// Semantic colors and paired typography, shared across every 1git control.
///
/// Values are logical pixels. Install through [`Self::install`] on the UI thread;
/// replacing the theme refreshes windows without resetting retained control state.
#[derive(Clone, Debug, rake::Theme)]
pub struct Theme {
    /// Selected palette identity.
    pub appearance: Appearance,
    /// Window and gallery background.
    pub background: Hsla,
    /// Translucent native window chrome behind the inset workspace.
    pub chrome: Hsla,
    /// Low-contrast panel separators from the original desktop palette.
    pub hairline: Hsla,
    /// Faint paths, hashes and supporting labels.
    pub faint_ink: Hsla,
    /// Added-line fill, independent of success control colors.
    pub diff_added: Hsla,
    /// Deleted-line fill, independent of destructive control colors.
    pub diff_deleted: Hsla,
    /// Hunk headers and code metadata.
    pub diff_hunk: Hsla,
    /// Patch code ink, independent of UI labels.
    pub diff_ink: Hsla,
    /// Patch coordinates and secondary code labels.
    pub diff_muted_ink: Hsla,
    /// Stronger token background for paired additions.
    pub diff_added_word: Hsla,
    /// Stronger token background for paired deletions.
    pub diff_deleted_word: Hsla,
    /// Added-line accent rail.
    pub diff_added_rail: Hsla,
    /// Deleted-line accent rail.
    pub diff_deleted_rail: Hsla,
    /// Main content surface.
    pub surface: Hsla,
    /// Raised neutral controls.
    pub surface_raised: Hsla,
    /// Inset areas.
    pub surface_sunken: Hsla,
    /// Neutral hover fill.
    pub hover: Hsla,
    /// Neutral pressed fill.
    pub pressed: Hsla,
    /// Primary readable content.
    pub ink: Hsla,
    /// Secondary readable content.
    pub muted_ink: Hsla,
    /// Empty native field hints.
    pub placeholder_ink: Hsla,
    /// Subtle separators and control outlines.
    pub line: Hsla,
    /// Accent text and checkbox fill.
    pub accent: Hsla,
    /// Text on a filled checkbox.
    pub on_accent: Hsla,
    /// Primary button fill.
    pub primary: Hsla,
    /// Primary button text.
    pub on_primary: Hsla,
    /// Primary hover fill.
    pub primary_hover: Hsla,
    /// Primary pressed fill.
    pub primary_pressed: Hsla,
    /// Destructive action text.
    pub danger: Hsla,
    /// Destructive primary button fill.
    pub danger_fill: Hsla,
    /// Text on destructive primary buttons.
    pub on_danger: Hsla,
    /// Destructive primary hover fill.
    pub danger_hover: Hsla,
    /// Destructive primary pressed fill.
    pub danger_pressed: Hsla,
    /// Positive status text.
    pub success: Hsla,
    /// Caution status text.
    pub warning: Hsla,
    /// Persistent row selection, distinct from focus.
    pub selection: Hsla,
    /// Keyboard focus outline.
    pub focus_ring: Hsla,
    /// Shared small-control corner radius.
    pub control: Pixels,
    /// Body labels and control text: 12/18 pixels.
    pub body: TextToken,
    /// Secondary captions: 10/14 pixels.
    pub caption: TextToken,
    /// Compact file labels and composer text: 11/16 pixels.
    pub small: TextToken,
    /// Section titles: 14/20 pixels.
    pub title: TextToken,
    /// Page headings: 20/28 pixels.
    pub heading: TextToken,
    /// Monospace text: 11/20 pixels.
    pub code: TextToken,
    /// Platform-appropriate monospace family; hosts may override it.
    pub mono: &'static str,
}

impl Default for Theme {
    fn default() -> Self {
        Self::dark()
    }
}

impl Theme {
    /// Refined dark 1git colors and compact desktop typography.
    #[must_use]
    pub fn dark() -> Self {
        Self::for_appearance(Appearance::Dark)
    }

    /// Matching light colors with the same layout metrics.
    #[must_use]
    pub fn light() -> Self {
        Self::for_appearance(Appearance::Light)
    }

    /// Resolve a complete palette. Color selection never changes control geometry.
    #[must_use]
    pub fn for_appearance(appearance: Appearance) -> Self {
        let dark = appearance == Appearance::Dark;
        let color = |light, dark_color| rgb_to_hsla(rgb(if dark { dark_color } else { light }));

        let text = |size, height, weight| TextToken {
            size: px(size),
            line_height: Some(px(height)),
            weight: Some(weight),
        };

        Self {
            appearance,
            background: color(0xf7f7f8, 0x17191d),
            chrome: gpui::transparent_black(),
            hairline: color(0x000000, 0xffffff).opacity(0.06),
            faint_ink: color(0x7f7f7f, 0x89909c),
            diff_added: color(0xe6ffed, 0x25392d),
            diff_deleted: color(0xffeef0, 0x422a30),
            diff_hunk: color(0xf8fafc, 0x25282f),
            diff_ink: color(0x24292e, 0xe6edf3),
            diff_muted_ink: color(0x586069, 0xa4acb7),
            diff_added_word: color(0xb6ecc4, 0x365940),
            diff_deleted_word: color(0xf4b8bf, 0x703b46),
            diff_added_rail: color(0x92c9a4, 0x3d6149),
            diff_deleted_rail: color(0xd5a0a7, 0x704148),
            surface: color(0xffffff, 0x202227),
            surface_raised: color(0x000000, 0xffffff).opacity(0.06),
            surface_sunken: color(0xf7f7f8, 0x1b1d22),
            hover: color(0x000000, 0xffffff).opacity(0.06),
            pressed: color(0x000000, 0xffffff).opacity(0.12),
            ink: color(0x111111, 0xe8eaed),
            muted_ink: color(0x5a5a5a, 0xb3b8c2),
            placeholder_ink: color(0x999999, 0x89909c),
            line: color(0x000000, 0xffffff).opacity(if dark { 0.12 } else { 0.1 }),
            accent: color(0x406bde, 0x80a7ff),
            on_accent: color(0xffffff, 0x17243c),
            primary: color(0x406bde, 0x2b3542),
            on_primary: color(0xffffff, 0x80a7ff),
            primary_hover: color(0x406bde, 0x303e53),
            primary_pressed: color(0x406bde, 0x253043),
            danger: color(0xb2676b, 0xe0878e),
            danger_fill: color(0xb53240, 0x582d37),
            on_danger: color(0xffffff, 0xffd3d7),
            danger_hover: color(0x9d2936, 0x6b3542),
            danger_pressed: color(0x87212c, 0x48252e),
            success: color(0x1a7f37, 0x69ba86),
            warning: color(0x8a5a10, 0xe9bd73),
            selection: color(0xf2f2f2, 0x2d3038),
            focus_ring: color(0x406bde, 0x99b8ff),
            control: px(4.),
            body: text(12., 18., FontWeight::NORMAL),
            caption: text(10., 14., FontWeight::NORMAL),
            small: text(11., 16., FontWeight::NORMAL),
            title: text(14., 20., FontWeight::SEMIBOLD),
            heading: text(20., 28., FontWeight::SEMIBOLD),
            code: text(11., 20., FontWeight::NORMAL),
            mono: if cfg!(target_os = "macos") {
                "Menlo"
            } else if cfg!(windows) {
                "Consolas"
            } else {
                "monospace"
            },
        }
    }

    /// Install or replace this theme on the current UI thread and refresh windows.
    pub fn install(self, cx: &mut App) {
        cx.set_window_appearance(Some(match self.appearance {
            Appearance::Light => gpui::WindowAppearance::Light,
            Appearance::Dark => gpui::WindowAppearance::Dark,
        }));
        rake::theme::install(cx, self);
    }

    /// Borrow the installed palette without cloning its values.
    ///
    /// # Panics
    /// Panics if the owner has not installed a theme on this UI thread.
    #[must_use]
    pub fn current() -> std::rc::Rc<Self> {
        rake::theme::current::<Self>()
    }

    pub(crate) fn transparent() -> Hsla {
        gpui::transparent_black()
    }
}
