//! Native modifier forwarding stays consistent between both reusable commit views.
use onegit_ui::{
    CommitGraph, CommitGraphData, CommitGraphState, CommitItem, CommitList, CommitListData,
    CommitSelectionEvent, GraphCommit, Theme,
};

use rake::gpui::{self, AppContext, InputEvent, prelude::*, px};
use std::{collections::HashSet, sync::Arc};

struct Host {
    graph: bool,
    list: CommitListData,
    data: CommitGraphData,
    state: gpui::Entity<CommitGraphState>,
    primary: gpui::SharedString,
    requests: Vec<CommitSelectionEvent>,
}

impl Render for Host {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let members = Arc::new(HashSet::from(["id-0".into(), "id-1".into()]));

        if self.graph {
            rake::view!{<CommitGraph selected={Some(self.primary.clone())} selected_ids={members}
                on_select_modified={Some(Box::new(cx.listener(|this,event:&CommitSelectionEvent,_,cx|{this.primary=event.id.clone();this.requests.push(event.clone());cx.notify();})))}
                {..CommitGraph::new("graph",self.data.clone(),&self.state)}/>}
                .into_any_element()
        } else {
            rake::view!{<CommitList selected={Some(self.primary.clone())} selected_ids={members}
                on_select_modified={Some(Box::new(cx.listener(|this,event:&CommitSelectionEvent,_,cx|{this.primary=event.id.clone();this.requests.push(event.clone());cx.notify();})))}
                {..CommitList::new("history","Commit history",self.list.clone())}/>}
                .into_any_element()
        }
    }
}

fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Host>) {
    for _ in 0..2 {
        cx.run_until_parked();
        cx.update_window(v.into(), |_, w, cx| w.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

#[test]
fn pointer_and_shift_keyboard_requests_reach_the_owner_even_for_already_selected_rows() {
    for graph in [false, true] {
        let mut cx = gpui::TestAppContext::single();

        cx.update(|cx| Theme::light().install(cx));
        let v = cx.open_window(gpui::size(px(1000.), px(300.)), |_, cx| {
            let items: Vec<_> = (0..4)
                .map(|i| CommitItem::new(format!("id-{i}"), format!("Commit {i}")))
                .collect();

            Host {
                graph,
                list: CommitListData::new(items.clone()).unwrap(),
                data: CommitGraphData::new(
                    items
                        .into_iter()
                        .enumerate()
                        .map(|(i, item)| GraphCommit {
                            item,
                            parents: if i < 3 {
                                vec![format!("id-{}", i + 1).into()]
                            } else {
                                vec![]
                            },
                        })
                        .collect(),
                )
                .unwrap(),
                state: cx.new(CommitGraphState::new),
                primary: "id-0".into(),
                requests: vec![],
            }
        });

        draw(&mut cx, v);
        let selector = if graph {
            "graph-row-0"
        } else {
            "commit-row-id-0"
        };

        let position = gpui::VisualTestContext::from_window(v.into(), &cx)
            .debug_bounds(selector)
            .unwrap()
            .center();

        cx.update_window(v.into(), |_, w, cx| {
            let modifiers = gpui::Modifiers {
                platform: true,
                ..Default::default()
            };

            w.dispatch_event(
                gpui::MouseDownEvent {
                    button: gpui::MouseButton::Left,
                    position,
                    modifiers,
                    click_count: 1,
                    first_mouse: false,
                }
                .to_platform_input(),
                cx,
            );
            w.dispatch_event(
                gpui::MouseUpEvent {
                    button: gpui::MouseButton::Left,
                    position,
                    modifiers,
                    click_count: 1,
                }
                .to_platform_input(),
                cx,
            );
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |host, _| {
            assert_eq!(host.requests.len(), 1);
            assert_eq!(host.requests[0].id, "id-0");
            assert!(host.requests[0].modifiers.platform);
        })
        .unwrap();
        cx.update_window(v.into(), |_, w, cx| {
            let keystroke = gpui::Keystroke::parse("shift-down").unwrap();

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
        draw(&mut cx, v);
        v.read_with(&cx, |host, _| {
            assert_eq!(host.requests.len(), 2, "one modified request per key");
            assert_eq!(host.requests[1].id, "id-1");
            assert!(host.requests[1].modifiers.shift);
        })
        .unwrap();
    }
}
