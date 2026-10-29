use rake::gpui::{self, ElementId, PathBuilder, SharedString, point, prelude::*, px};

/// Small built-in line glyphs; rendered as native paths without asset registration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconName {
    /// Confirm or checked state.
    Check,
    /// Mixed checkbox state.
    Minus,
    /// Add something.
    Plus,
    /// Close or remove.
    Close,
    /// Error or important warning.
    Alert,
    /// Refresh/retry.
    Refresh,
    /// Search or filter.
    Search,
    /// Expand a menu.
    ChevronDown,
    /// Source branch.
    Branch,
    /// File/document.
    File,
    /// Folder.
    Folder,
    /// Light appearance.
    Sun,
    /// In-progress work, without implying a percentage.
    Working,
}

/// Native logical-pixel glyph size.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum IconSize {
    /// Twelve-pixel supporting glyph.
    Small,
    /// Sixteen-pixel standard glyph.
    #[default]
    Medium,
    /// Twenty-pixel prominent glyph.
    Large,
}

impl IconSize {
    /// Logical-pixel dimension, identical on both palettes.
    #[must_use]
    pub const fn pixels(self) -> f32 {
        match self {
            Self::Small => 12.,
            Self::Medium => 16.,
            Self::Large => 20.,
        }
    }
}

/// A crisp monochrome glyph inheriting its parent's foreground color.
#[derive(Debug, IntoElement)]
pub struct Icon {
    /// Stable component root identity.
    pub id: ElementId,
    /// Built-in native path.
    pub name: IconName,
    /// Logical-pixel size.
    pub size: IconSize,
    /// Optional standalone accessible label; omit for decorative control glyphs.
    pub label: Option<SharedString>,
}

impl Icon {
    /// Create a decorative standard-size glyph.
    #[must_use]
    pub fn new(id: impl Into<ElementId>, name: IconName) -> Self {
        Self {
            id: id.into(),
            name,
            size: IconSize::Medium,
            label: None,
        }
    }
}

impl RenderOnce for Icon {
    fn render(self, _: &mut gpui::Window, _: &mut gpui::App) -> impl IntoElement {
        let dimension = px(self.size.pixels());
        let name = self.name;
        let labelled = self.label.as_ref().is_some_and(|s| !s.is_empty());

        rake::view! {
            <span id={self.id} class="shrink-0" aria-label={self.label.unwrap_or_default()}
                style={|s| s.size(dimension).when(labelled, |s| s.role(gpui::accesskit::Role::Image))}>
                {gpui::canvas(|_, _, _| {}, move |bounds, _, window, _| {
                    paint_icon(name,bounds,window);
                }).size_full()}
            </span>
        }
    }
}

fn paint_icon(name: IconName, bounds: gpui::Bounds<gpui::Pixels>, window: &mut gpui::Window) {
    let unit = bounds.size.width / 24.;
    let position = |x: f32, y: f32| bounds.origin + point(unit * x, unit * y);
    let mut path = PathBuilder::stroke(unit * 1.65);

    match name {
        IconName::Check => stroke(&mut path, &position, &[(5., 12.), (10., 17.), (19., 7.)]),
        IconName::Minus => stroke(&mut path, &position, &[(5., 12.), (19., 12.)]),
        IconName::Plus => {
            stroke(&mut path, &position, &[(5., 12.), (19., 12.)]);
            stroke(&mut path, &position, &[(12., 5.), (12., 19.)]);
        }
        IconName::Close => {
            stroke(&mut path, &position, &[(6., 6.), (18., 18.)]);
            stroke(&mut path, &position, &[(18., 6.), (6., 18.)]);
        }
        IconName::Alert => {
            circle(&mut path, &position, (12., 12.), 9.);
            stroke(&mut path, &position, &[(12., 7.), (12., 13.)]);
            stroke(&mut path, &position, &[(12., 16.), (12., 17.)]);
        }
        IconName::ChevronDown => stroke(&mut path, &position, &[(6., 9.), (12., 15.), (18., 9.)]),
        IconName::File => {
            stroke(
                &mut path,
                &position,
                &[
                    (14., 3.),
                    (5., 3.),
                    (5., 21.),
                    (19., 21.),
                    (19., 8.),
                    (14., 3.),
                    (14., 8.),
                    (19., 8.),
                ],
            );
        }
        IconName::Folder => stroke(
            &mut path,
            &position,
            &[
                (3., 6.),
                (10., 6.),
                (12., 9.),
                (21., 9.),
                (21., 20.),
                (3., 20.),
                (3., 6.),
            ],
        ),
        IconName::Branch => {
            stroke(&mut path, &position, &[(6., 7.), (6., 17.)]);
            stroke(&mut path, &position, &[(6., 14.), (14., 14.)]);
            path.curve_to(position(18., 10.), position(18., 14.));
            path.line_to(position(18., 7.));
            circle(&mut path, &position, (6., 5.), 2.);
            circle(&mut path, &position, (6., 19.), 2.);
            circle(&mut path, &position, (18., 5.), 2.);
        }
        IconName::Refresh => {
            path.move_to(position(20., 10.));
            path.cubic_bezier_to(position(10., 4.), position(18., 5.), position(14., 3.));
            path.cubic_bezier_to(position(4., 14.), position(5., 5.), position(2., 9.));
            path.cubic_bezier_to(position(19., 18.), position(6., 21.), position(14., 23.));
            stroke(&mut path, &position, &[(20., 3.), (20., 10.), (13., 10.)]);
        }
        IconName::Working => {
            stroke(
                &mut path,
                &position,
                &[(6., 3.), (18., 3.), (18., 7.), (9., 17.), (9., 21.)],
            );
            stroke(
                &mut path,
                &position,
                &[(6., 21.), (18., 21.), (18., 17.), (9., 7.), (9., 3.)],
            );
        }
        IconName::Search => {
            circle(&mut path, &position, (10., 10.), 6.);
            stroke(&mut path, &position, &[(14.5, 14.5), (21., 21.)]);
        }
        IconName::Sun => {
            circle(&mut path, &position, (12., 12.), 4.);

            for (a, b) in [
                ((12., 2.), (12., 5.)),
                ((12., 19.), (12., 22.)),
                ((2., 12.), (5., 12.)),
                ((19., 12.), (22., 12.)),
                ((4., 4.), (6., 6.)),
                ((18., 18.), (20., 20.)),
                ((4., 20.), (6., 18.)),
                ((18., 6.), (20., 4.)),
            ] {
                stroke(&mut path, &position, &[a, b]);
            }
        }
    }

    if let Ok(path) = path.build() {
        window.paint_path(path, window.text_style().color);
    }
}

fn stroke(
    path: &mut PathBuilder,
    position: &impl Fn(f32, f32) -> gpui::Point<gpui::Pixels>,
    points: &[(f32, f32)],
) {
    if let Some(&(x, y)) = points.first() {
        path.move_to(position(x, y));
    }

    for &(x, y) in points.iter().skip(1) {
        path.line_to(position(x, y));
    }
}

fn circle(
    path: &mut PathBuilder,
    position: &impl Fn(f32, f32) -> gpui::Point<gpui::Pixels>,
    (x, y): (f32, f32),
    radius: f32,
) {
    // Four cubic segments approximate a circle at every logical-pixel glyph size.
    let control = radius * 0.552_284_8;

    path.move_to(position(x + radius, y));
    path.cubic_bezier_to(
        position(x, y + radius),
        position(x + radius, y + control),
        position(x + control, y + radius),
    );
    path.cubic_bezier_to(
        position(x - radius, y),
        position(x - control, y + radius),
        position(x - radius, y + control),
    );
    path.cubic_bezier_to(
        position(x, y - radius),
        position(x - radius, y - control),
        position(x - control, y - radius),
    );
    path.cubic_bezier_to(
        position(x + radius, y),
        position(x + control, y - radius),
        position(x + radius, y - control),
    );
    path.close();
}
