//! 1git components on plain GPUI. Nothing here depends on the Rake runtime, so the
//! components stay reusable by other GPUI applications.

mod button;
mod theme;

pub use button::{Button, ButtonVariant};
pub use theme::Theme;
