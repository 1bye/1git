use gpui::{Hsla, rgb, rgb_to_hsla};

/// Color tokens shared by every component.
#[derive(Clone, Copy, Debug)]
pub struct Theme {
    /// Window background.
    pub background: Hsla,
    /// Primary text.
    pub foreground: Hsla,
    /// Secondary text.
    pub muted: Hsla,
    /// Raised surfaces such as buttons and cards.
    pub surface: Hsla,
    /// Surface under the pointer.
    pub surface_hover: Hsla,
    /// Primary action background.
    pub accent: Hsla,
    /// Text drawn on the accent color.
    pub accent_foreground: Hsla,
}

impl Theme {
    /// The default dark palette.
    pub fn dark() -> Self {
        Self {
            background: rgb_to_hsla(rgb(0x111214)),
            foreground: rgb_to_hsla(rgb(0xeceef1)),
            muted: rgb_to_hsla(rgb(0x8b9099)),
            surface: rgb_to_hsla(rgb(0x1d1f23)),
            surface_hover: rgb_to_hsla(rgb(0x272a30)),
            accent: rgb_to_hsla(rgb(0x4c8dff)),
            accent_foreground: rgb_to_hsla(rgb(0xffffff)),
        }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Self::dark()
    }
}
