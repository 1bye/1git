//! Match the existing app's public AppKit Sidebar material without GPUI's private-layer edits.
use onegit_ui::Appearance;
use rake::gpui;

pub(super) fn install(window: &gpui::Window, appearance: Appearance) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::install(window, appearance)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, appearance);

        Ok(())
    }
}

pub(super) fn appearance(window: &gpui::Window, appearance: Appearance) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::appearance(window, appearance)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, appearance);

        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::{MainThreadMarker, MainThreadOnly};

    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
        NSAutoresizingMaskOptions, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
    };

    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    fn view(window: &gpui::Window) -> Result<Option<&NSView>, String> {
        if MainThreadMarker::new().is_none() {
            return Err("Native material requires the main thread".into());
        }

        let Ok(handle) = HasWindowHandle::window_handle(window) else {
            return Ok(None);
        };

        let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
            return Ok(None);
        };

        // SAFETY: GPUI supplies its live AppKit NSView; the window borrow bounds its lifetime,
        // and the main-thread check above satisfies NSView's thread requirement.
        Ok(Some(unsafe { &*handle.ns_view.as_ptr().cast::<NSView>() }))
    }

    pub(super) fn install(window: &gpui::Window, palette: Appearance) -> Result<(), String> {
        let Some(view) = view(window)? else {
            return Ok(());
        };

        let native = view.window().ok_or("Native window has closed")?;

        let content = native
            .contentView()
            .ok_or("Native content view is unavailable")?;

        let mtm = MainThreadMarker::new().ok_or("Native material requires the main thread")?;

        window.set_background_appearance(gpui::WindowBackgroundAppearance::Transparent);
        let effect =
            NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), content.bounds());

        effect.setMaterial(NSVisualEffectMaterial::Sidebar);
        effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        effect.setState(NSVisualEffectState::Active);
        effect.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        content.addSubview_positioned_relativeTo(&effect, NSWindowOrderingMode::Below, None);

        // AppKit retains the subview and resizes it with the content view; no raw ownership escapes.
        appearance(window, palette)
    }

    pub(super) fn appearance(window: &gpui::Window, palette: Appearance) -> Result<(), String> {
        let Some(view) = view(window)? else {
            return Ok(());
        };

        let native = view.window().ok_or("Native window has closed")?;

        // SAFETY: AppKit's immutable appearance-name constants are read on the main thread.
        let name = unsafe {
            match palette {
                Appearance::Light => NSAppearanceNameAqua,
                Appearance::Dark => NSAppearanceNameDarkAqua,
            }
        };

        let appearance =
            NSAppearance::appearanceNamed(name).ok_or("Native appearance is unavailable")?;

        native.setAppearance(Some(&appearance));

        Ok(())
    }
}
