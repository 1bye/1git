//! Native input dispatch and composition checks on GPUI's deterministic platform.
use onegit_ui::{
    Button, InputAvailability, InputEvent, InputState, InputValidation, InputVariant, SearchField,
    TextArea, TextInput, Theme,
};

use rake::gpui::{self, EntityInputHandler, Focusable, InputEvent as NativeEvent, prelude::*};

rake::theme!(Theme);

struct Fields {
    focus: gpui::FocusHandle,
    text: gpui::Entity<InputState>,
    search: gpui::Entity<InputState>,
    area: gpui::Entity<InputState>,
    availability: InputAvailability,
    variant: InputVariant,
    changed: usize,
    submitted: usize,
    _subscriptions: Vec<gpui::Subscription>,
}

impl Render for Fields {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {
            <div class="size-full flex flex-col gap-2" focus={&self.focus} tab-navigation={true}>
                <TextInput variant={self.variant} availability={self.availability} placeholder={"Branch name".into()}
                    validation={InputValidation::Invalid("Example validation".into())}
                    {..TextInput::new("text",&self.text,"Branch")}/>
                <SearchField {..SearchField::new("search",&self.search,"Files")}/>
                <TextArea rows={3} {..TextArea::new("area",&self.area,"Message")}/>
                <Button {..Button::new("after","After fields")}/>
            </div>
        }
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Fields>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::dark().install(cx));
    let view = cx.open_window(gpui::size(gpui::px(500.), gpui::px(400.)), |window, cx| {
        let focus = cx.focus_handle();

        window.focus(&focus, cx);
        window.activate_window();
        let text = cx.new(|cx| InputState::new("", window, cx));
        let search = cx.new(|cx| InputState::new("", window, cx));
        let area = cx.new(|cx| InputState::new("", window, cx));

        let subscriptions = [&text, &search, &area]
            .into_iter()
            .map(|state| {
                cx.subscribe(state, |this: &mut Fields, _, event, cx| {
                    match event {
                        InputEvent::Changed => this.changed += 1,
                        InputEvent::Submitted => this.submitted += 1,
                    };

                    cx.notify();
                })
            })
            .collect();

        Fields {
            focus,
            text,
            search,
            area,
            availability: InputAvailability::Enabled,
            variant: InputVariant::Outlined,
            changed: 0,
            submitted: 0,
            _subscriptions: subscriptions,
        }
    });

    draw(&mut cx, view);

    (cx, view)
}

fn draw(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Fields>) {
    cx.run_until_parked();
    cx.update_window(view.into(), |_, w, cx| w.draw(cx).clear(cx))
        .unwrap();
}

fn key(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Fields>, key: &str) {
    cx.update_window(view.into(), |_, w, cx| {
        let keystroke = gpui::Keystroke::parse(key).unwrap();

        w.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: keystroke.clone(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
        w.dispatch_event(gpui::KeyUpEvent { keystroke }.to_platform_input(), cx);
    })
    .unwrap();
    draw(cx, view);
}

fn primary(key: &str) -> String {
    format!(
        "{}-{key}",
        if cfg!(target_os = "macos") {
            "cmd"
        } else {
            "ctrl"
        }
    )
}

fn native_insert(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Fields>, text: &str) {
    view.update(cx, |fields, w, cx| {
        fields.text.update(cx, |input, cx| {
            input.replace_text_in_range(None, text, w, cx)
        })
    })
    .unwrap();
    draw(cx, view);
}

#[test]
fn unicode_clipboard_keyboard_submission_and_history_use_the_same_buffer() {
    let (mut cx, view) = setup();

    key(&mut cx, view, "tab");
    native_insert(&mut cx, view, "café 👨‍👩‍👧‍👦");
    key(&mut cx, view, "backspace");
    assert_eq!(
        view.read_with(&cx, |v, cx| v.text.read(cx).text().to_owned())
            .unwrap(),
        "café "
    );
    key(&mut cx, view, &primary("z"));
    assert_eq!(
        view.read_with(&cx, |v, cx| v.text.read(cx).text().to_owned())
            .unwrap(),
        "café 👨‍👩‍👧‍👦"
    );
    key(&mut cx, view, &primary("a"));
    key(&mut cx, view, &primary("c"));
    assert_eq!(
        cx.update(|cx| cx.read_from_clipboard().and_then(|v| v.text()))
            .unwrap(),
        "café 👨‍👩‍👧‍👦"
    );
    native_insert(&mut cx, view, "one\r\ntwo");
    assert_eq!(
        view.read_with(&cx, |v, cx| v.text.read(cx).text().to_owned())
            .unwrap(),
        "one two"
    );
    key(&mut cx, view, "enter");
    assert_eq!(view.read_with(&cx, |v, _| v.submitted).unwrap(), 1);
    assert!(view.read_with(&cx, |v, _| v.changed).unwrap() >= 3);
}

#[test]
fn native_composition_uses_utf16_ranges_and_commits_one_undo_step() {
    let (mut cx, view) = setup();

    key(&mut cx, view, "tab");
    native_insert(&mut cx, view, "a😀");
    view.update(&mut cx, |v, w, cx| {
        v.text.update(cx, |input, cx| {
            input.replace_and_mark_text_in_range(Some(3..3), "に", Some(1..1), w, cx);
            assert_eq!(input.marked_text_range(w, cx), Some(3..4));
            input.replace_and_mark_text_in_range(None, "日本", Some(0..2), w, cx);
            assert_eq!(input.selected_text_range(false, w, cx).unwrap().range, 3..5);
            input.replace_text_in_range(None, "日本語", w, cx);
            assert_eq!(input.marked_text_range(w, cx), None);
            assert!(
                input
                    .bounds_for_range(3..3, Default::default(), w, cx)
                    .is_some()
            );
        })
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        view.read_with(&cx, |v, cx| v.text.read(cx).text().to_owned())
            .unwrap(),
        "a😀日本語"
    );
    key(&mut cx, view, &primary("z"));
    assert_eq!(
        view.read_with(&cx, |v, cx| v.text.read(cx).text().to_owned())
            .unwrap(),
        "a😀"
    );
}

#[test]
fn readonly_blocks_edits_but_allows_copy_and_disabled_skips_tab() {
    let (mut cx, view) = setup();

    native_insert(&mut cx, view, "main");
    view.update(&mut cx, |v, _, cx| {
        v.availability = InputAvailability::ReadOnly;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, view);
    key(&mut cx, view, "tab");
    key(&mut cx, view, &primary("a"));
    key(&mut cx, view, &primary("c"));
    native_insert(&mut cx, view, "blocked");
    assert_eq!(
        cx.update(|cx| cx.read_from_clipboard().and_then(|v| v.text()))
            .unwrap(),
        "main"
    );
    assert_eq!(
        view.read_with(&cx, |v, cx| v.text.read(cx).text().to_owned())
            .unwrap(),
        "main"
    );
    view.update(&mut cx, |v, w, cx| {
        v.availability = InputAvailability::Disabled;
        w.focus(&v.focus, cx);
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, view);
    key(&mut cx, view, "tab");
    assert!(
        view.update(&mut cx, |v, w, cx| v
            .search
            .read(cx)
            .focus_handle(cx)
            .is_focused(w))
            .unwrap()
    );
}

#[test]
fn search_escape_and_multiline_enter_preserve_selection_across_theme_changes() {
    let (mut cx, view) = setup();

    key(&mut cx, view, "tab");
    key(&mut cx, view, "tab");
    view.update(&mut cx, |v, w, cx| {
        v.search.update(cx, |input, cx| {
            input.replace_text_in_range(None, "button", w, cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    key(&mut cx, view, "enter");
    assert_eq!(view.read_with(&cx, |v, _| v.submitted).unwrap(), 1);
    key(&mut cx, view, "escape");
    assert_eq!(
        view.read_with(&cx, |v, cx| v.search.read(cx).text().to_owned())
            .unwrap(),
        ""
    );
    key(&mut cx, view, "tab");
    view.update(&mut cx, |v, w, cx| {
        v.area.update(cx, |input, cx| {
            input.replace_text_in_range(None, "first", w, cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    key(&mut cx, view, "enter");
    view.update(&mut cx, |v, w, cx| {
        v.area.update(cx, |input, cx| {
            input.replace_text_in_range(None, "日本", w, cx);
            input.select(0..5, cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    key(&mut cx, view, &primary("enter"));
    assert_eq!(view.read_with(&cx, |v, _| v.submitted).unwrap(), 2);
    cx.update(|cx| Theme::light().install(cx));
    draw(&mut cx, view);
    assert_eq!(
        view.read_with(&cx, |v, cx| (
            v.area.read(cx).text().to_owned(),
            v.area.read(cx).selection()
        ))
        .unwrap(),
        ("first\n日本".to_owned(), 0..5)
    );
}

#[test]
fn multiline_wrap_and_scrolling_keep_native_caret_geometry_visible() {
    let (mut cx, view) = setup();

    key(&mut cx, view, "tab");
    key(&mut cx, view, "tab");
    key(&mut cx, view, "tab");
    let start = view
        .update(&mut cx, |v, w, cx| {
            v.area.update(cx, |input, cx| {
                input
                    .bounds_for_range(0..0, Default::default(), w, cx)
                    .unwrap()
            })
        })
        .unwrap();

    let text=(0..40).map(|i|format!("Line {i}: A deliberately long commit description with words that wrap at the field edge. 日本🙂")).collect::<Vec<_>>().join("\n");
    let len = text.encode_utf16().count();

    view.update(&mut cx, |v, _, cx| {
        v.area.update(cx, |input, cx| input.set_text(text, cx))
    })
    .unwrap();
    draw(&mut cx, view);
    let end = view
        .update(&mut cx, |v, w, cx| {
            v.area.update(cx, |input, cx| {
                let bounds = input
                    .bounds_for_range(len..len, Default::default(), w, cx)
                    .unwrap();

                let index = input
                    .character_index_for_point(
                        bounds.origin + gpui::point(gpui::px(0.), bounds.size.height / 2.),
                        w,
                        cx,
                    )
                    .unwrap();

                assert_eq!(
                    index, len,
                    "native hit testing must match the scrolled caret"
                );

                bounds
            })
        })
        .unwrap();

    assert!(
        end.top() >= start.top() && end.bottom() <= start.top() + gpui::px(54.),
        "caret must fit within three visible lines: {start:?} {end:?}"
    );
    key(&mut cx, view, &primary("home"));
    let home = view
        .update(&mut cx, |v, w, cx| {
            v.area.update(cx, |input, cx| {
                input
                    .bounds_for_range(0..0, Default::default(), w, cx)
                    .unwrap()
            })
        })
        .unwrap();

    assert_eq!(
        home.top(),
        start.top(),
        "document navigation must reveal the beginning again"
    );
    view.update(&mut cx, |v, w, cx| {
        v.area.update(cx, |input, cx| {
            let end = input.text().len();

            input.select(end..end, cx);
        });
        w.resize(gpui::size(gpui::px(260.), gpui::px(400.)));
        // The test platform does not dispatch the native resize callback.
        w.bounds_changed(cx);
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        view.update(&mut cx, |_, w, _| w.viewport_size().width)
            .unwrap(),
        gpui::px(260.)
    );
    let resized = view
        .update(&mut cx, |v, w, cx| {
            v.area.update(cx, |input, cx| {
                input
                    .bounds_for_range(len..len, Default::default(), w, cx)
                    .unwrap()
            })
        })
        .unwrap();

    assert!(
        resized.right() <= gpui::px(260.),
        "resizing must reveal the caret at the new wrap width"
    );
    view.update(&mut cx, |v, _, cx| {
        v.area
            .update(cx, |input, cx| input.set_text("x".repeat(300), cx))
    })
    .unwrap();
    draw(&mut cx, view);
    let unbroken = view
        .update(&mut cx, |v, w, cx| {
            v.area.update(cx, |input, cx| {
                input
                    .bounds_for_range(300..300, Default::default(), w, cx)
                    .unwrap()
            })
        })
        .unwrap();

    assert!(
        unbroken.right() <= gpui::px(260.),
        "long words must wrap within the field"
    );
}

#[test]
fn plain_fields_keep_native_editing_history_and_selection_across_style_changes() {
    let (mut cx, view) = setup();

    key(&mut cx, view, "tab");
    native_insert(&mut cx, view, "café 日本語");
    key(&mut cx, view, "left");
    let selection = view
        .read_with(&cx, |view, cx| view.text.read(cx).selection())
        .unwrap();

    view.update(&mut cx, |view, _, cx| {
        view.variant = InputVariant::Plain;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        view.read_with(&cx, |view, cx| view.text.read(cx).selection())
            .unwrap(),
        selection
    );
    native_insert(&mut cx, view, "!");
    key(&mut cx, view, &primary("z"));
    assert_eq!(
        view.read_with(&cx, |view, cx| view.text.read(cx).text().to_owned())
            .unwrap(),
        "café 日本語"
    );
    key(&mut cx, view, "enter");
    assert_eq!(view.read_with(&cx, |view, _| view.submitted).unwrap(), 1);
}
