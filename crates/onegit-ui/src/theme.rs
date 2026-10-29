use rake::gpui::{self, App, FontWeight, Hsla, Pixels, px, rgb, rgb_to_hsla};
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
            surface: color(0xffffff, 0x202227),
            surface_raised: color(0xf2f3f5, 0x282b32),
            surface_sunken: color(0xf7f7f8, 0x1b1d22),
            hover: color(0xe9ecf1, 0x30343d),
            pressed: color(0xdfe4ed, 0x383e49),
            ink: color(0x191b20, 0xe8eaed),
            muted_ink: color(0x626976, 0xb3b8c2),
            line: color(0xd6d9e0, 0x3b414d),
            accent: color(0x406bde, 0x80a7ff),
            on_accent: color(0xffffff, 0x17243c),
            primary: color(0x406bde, 0x2b3c59),
            on_primary: color(0xffffff, 0xc5d8ff),
            primary_hover: color(0x355fcd, 0x344b70),
            primary_pressed: color(0x2c51b4, 0x25334d),
            danger: color(0xb53240, 0xef9097),
            danger_fill: color(0xb53240, 0x582d37),
            on_danger: color(0xffffff, 0xffd3d7),
            danger_hover: color(0x9d2936, 0x6b3542),
            danger_pressed: color(0x87212c, 0x48252e),
            success: color(0x247044, 0x81c49b),
            warning: color(0x8a5a10, 0xe9bd73),
            selection: color(0xe7edfb, 0x303d54),
            focus_ring: color(0x406bde, 0x99b8ff),
            control: px(4.),
            body: text(12., 18., FontWeight::NORMAL),
            caption: text(10., 14., FontWeight::NORMAL),
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
