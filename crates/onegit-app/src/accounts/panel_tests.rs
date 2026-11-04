//! Source setup, explicit submit, recovery/removal and reduced-motion interaction contracts.
use super::{
    http::{Failure, Network, Reply, Transport},
    panel::{Method, Panel},
    service::Accounts,
    service_tests::MemoryVault,
    store::Store,
};

use onegit_git::Cancellation;
use onegit_ui::{DialogHostState, Theme};
use rake::gpui::{self, AppContext, Focusable, InputEvent as _, prelude::*, px};
use std::{rc::Rc, sync::Arc, time::Duration};

struct Provider;

impl Transport for Provider {
    fn request(
        &self,
        _: &url::Url,
        _: Option<&str>,
        _: Option<&[(&str, &str)]>,
        cancel: &Cancellation,
    ) -> Result<Reply, Failure> {
        super::http::cancelled(cancel)?;

        Ok(Reply {
            status: 200,
            data: serde_json::json!({"id":7,"login":"tester","html_url":"https://github.com/tester"}),
        })
    }
}

struct Shell {
    panel: gpui::Entity<Panel>,
    host: DialogHostState,
}

impl Render for Shell {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        let body=rake::view!{<div class="absolute left-[248px] top-[42px] right-[6px] bottom-[6px]" style={|s|s.bg(Theme::current().surface).text_color(Theme::current().ink)}>{self.panel.clone()}</div>}.into_any_element();

        rake::view! {<onegit_ui::DialogHost state={self.host.clone()} body={body} children={Vec::new()}/>}
    }
}

fn setup() -> (
    tempfile::TempDir,
    gpui::TestAppContext,
    gpui::WindowHandle<Shell>,
    gpui::Entity<Panel>,
) {
    let dir = tempfile::tempdir().unwrap();
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::dark().install(cx));
    let view = cx.open_window(gpui::size(px(1280.), px(820.)), |window, cx| {
        let host = DialogHostState::new(cx);

        let panel = cx.new(|cx| {
            let mut p = Panel::new(&host, window, cx);

            let mut service = Accounts::new(
                Store::new(dir.path().join("accounts.json")),
                Rc::new(MemoryVault::default()),
                cx,
            );

            service.network = Network {
                transport: Arc::new(Provider),
            };
            p.accounts = Some(Rc::new(service));
            p.open(cx);

            p
        });

        Shell { panel, host }
    });

    let panel = view.read_with(&cx, |v, _| v.panel.clone()).unwrap();

    settle(&mut cx, view);

    (dir, cx, view, panel)
}

fn settle(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Shell>) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update_window(view.into(), |_, w, cx| w.draw(cx).clear(cx))
            .unwrap();
    }

    cx.executor().advance_clock(Duration::from_millis(200));
    cx.run_until_parked();
    cx.update_window(view.into(), |_, w, cx| w.draw(cx).clear(cx))
        .unwrap();
}

#[test]
fn account_form_requires_explicit_connect_clears_secrets_and_cancels_removal() {
    let (_dir, mut cx, view, p) = setup();

    view.update(&mut cx, |_, w, cx| {
        p.update(cx, |p, cx| {
            p.begin(None, w, cx);
            p.method(Method::Token, cx);
            p.token
                .update(cx, |i, cx| i.set_text("synthetic-token", cx));
            w.focus(&p.token.read(cx).focus_handle(cx), cx);
        })
    })
    .unwrap();
    settle(&mut cx, view);
    cx.update_window(view.into(), |_, w, cx| {
        let key = gpui::Keystroke::parse("enter").unwrap();

        w.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: key,
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    settle(&mut cx, view);
    assert!(p.read_with(&cx, |p, _| {
        p.accounts
            .as_ref()
            .unwrap()
            .store
            .read()
            .unwrap()
            .accounts
            .is_empty()
    }));
    p.update(&mut cx, |p, cx| p.connect(cx));
    settle(&mut cx, view);
    assert!(!p.read_with(&cx, |p, _| p.pending));
    let account = p.read_with(&cx, |p, cx| {
        assert!(!p.form);
        assert!(p.token.read(cx).text().is_empty());
        assert!(p.error.is_none(), "{:?}", p.error);

        p.review.as_ref().unwrap().accounts[0].clone()
    });

    view.update(&mut cx, |_, w, cx| {
        p.update(cx, |p, cx| p.remove(account.clone(), w, cx))
    })
    .unwrap();
    settle(&mut cx, view);
    assert_eq!(
        p.read_with(&cx, |p, _| p
            .accounts
            .as_ref()
            .unwrap()
            .store
            .read()
            .unwrap()
            .accounts
            .len()),
        1
    );
    view.update(&mut cx, |_, w, cx| {
        p.update(cx, |p, cx| {
            p.dialog.update(cx, |d, cx| d.close(w, cx));
        })
    })
    .unwrap();
    settle(&mut cx, view);
    assert_eq!(
        p.read_with(&cx, |p, _| p
            .accounts
            .as_ref()
            .unwrap()
            .store
            .read()
            .unwrap()
            .accounts
            .len()),
        1
    );
    view.update(&mut cx, |_, w, cx| {
        p.update(cx, |p, cx| p.remove(account.clone(), w, cx))
    })
    .unwrap();
    p.update(&mut cx, |p, cx| p.confirm_remove(cx));
    settle(&mut cx, view);
    assert!(p.read_with(&cx, |p, _| p.review.as_ref().unwrap().accounts.is_empty()));
}

#[test]
fn changing_method_hiding_or_cancelling_never_retains_a_token() {
    let (_dir, mut cx, view, p) = setup();

    view.update(&mut cx, |_, w, cx| {
        p.update(cx, |p, cx| p.begin(None, w, cx))
    })
    .unwrap();
    settle(&mut cx, view);
    p.update(&mut cx, |p, cx| {
        p.method(Method::Token, cx);
        p.token
            .update(cx, |i, cx| i.set_text("synthetic-first", cx));
        p.method(Method::Browser, cx);
        assert!(p.token.read(cx).text().is_empty());
        p.method(Method::Token, cx);
        p.token
            .update(cx, |i, cx| i.set_text("synthetic-second", cx));
        p.hide(cx);
        assert!(p.token.read(cx).text().is_empty());
    });
    view.update(&mut cx, |_, w, cx| p.update(cx, |p, cx| p.cancel(w, cx)))
        .unwrap();
    settle(&mut cx, view);
    assert!(!p.read_with(&cx, |p, _| p.form));
}

#[test]
fn account_editor_matches_split_geometry_and_motion_stops_when_settled() {
    for reduced in [false, true] {
        let (_dir, mut cx, view, p) = setup();

        cx.update(|cx| cx.set_reduce_motion(reduced));
        view.update(&mut cx, |_, w, cx| {
            p.update(cx, |p, cx| p.begin(None, w, cx))
        })
        .unwrap();
        settle(&mut cx, view);
        let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
        let bounds = visual.debug_bounds("account-editor").unwrap();

        assert_eq!(bounds.size.width, px(513.));
        assert_eq!(bounds.right(), px(1274.));
        cx.update_window(view.into(), |_, w, cx| w.simulate_next_frame(cx))
            .unwrap();
        settle(&mut cx, view);
        assert_eq!(
            cx.update_window(view.into(), |_, w, cx| w.simulate_next_frame(cx))
                .unwrap(),
            0
        );
    }
}

#[test]
fn browser_setup_and_advanced_fields_keep_distinct_native_identities() {
    let (_dir, mut cx, view, p) = setup();

    view.update(&mut cx, |_, w, cx| {
        p.update(cx, |p, cx| p.begin(None, w, cx))
    })
    .unwrap();
    settle(&mut cx, view);
    let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
    let name = visual.debug_bounds("account-setup-value-name").unwrap();
    let homepage = visual.debug_bounds("account-setup-value-homepage").unwrap();
    let callback = visual.debug_bounds("account-setup-value-callback").unwrap();

    assert!(name.bottom() <= homepage.top());
    assert!(homepage.bottom() <= callback.top());
    p.update(&mut cx, |p, cx| {
        p.provider(super::model::Provider::GitLab, cx);
        p.advanced = true;
        cx.notify();
    });
    settle(&mut cx, view);
    let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
    let client = visual.debug_bounds("account-field-account-client").unwrap();
    let host = visual.debug_bounds("account-field-account-host").unwrap();

    let callback = visual
        .debug_bounds("account-field-account-callback")
        .unwrap();

    assert!(client.bottom() <= host.top());
    assert!(host.bottom() <= callback.top());
}

#[test]
fn switching_cli_method_ignores_the_cancelled_discovery_result() {
    struct Gh;

    impl super::cli::Run for Gh {
        fn run(&self, _: &[&str], cancel: &Cancellation) -> Result<super::model::Secret, String> {
            if cancel.is_cancelled() {
                return Err("Cancelled old discovery".into());
            }

            Ok(super::model::Secret::encoded(
                r#"{"hosts":{"github.com":[{"login":"current","active":true,"state":"success"}]}}"#
                    .into(),
            ))
        }
    }
    let (_dir, mut cx, view, p) = setup();

    view.update(&mut cx, |_, w, cx| {
        p.update(cx, |p, cx| {
            Rc::get_mut(p.accounts.as_mut().unwrap())
                .expect("isolated panel owns service")
                .cli = super::cli::Cli { run: Arc::new(Gh) };
            p.begin(None, w, cx);
            p.method(Method::Cli, cx);
            p.method(Method::Token, cx);
            p.method(Method::Cli, cx);
        })
    })
    .unwrap();
    settle(&mut cx, view);
    p.read_with(&cx, |p, _| {
        assert!(!p.cli_loading);
        assert!(p.cli_error.is_none(), "{:?}", p.cli_error);
        assert_eq!(p.cli_accounts[0].username, "current");
        assert_eq!(p.cli_selected, Some(0));
    });
}
