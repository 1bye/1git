import { lightColors } from "@1git/design-tokens";
import { StyleSheet } from "@1git/gpuix-stylesheet";

// Phosphor Icons 2.1.10, Light weight. See ../../../LICENSES/Phosphor-Icons.txt.
const sources = {
  close:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"/></svg>',
  add: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M222,128a6,6,0,0,1-6,6H134v82a6,6,0,0,1-12,0V134H40a6,6,0,0,1,0-12h82V40a6,6,0,0,1,12,0v82h82A6,6,0,0,1,222,128Z"/></svg>',
};

const styles = StyleSheet.create({
  icon: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: lightColors.editorMuted,
    pointerEvents: "none",
  },
});

/** The tab strip's two Phosphor Light glyphs, rendered as native SVG masks. */
export function WorkspaceTabIcon({
  name,
  testId,
}: {
  name: keyof typeof sources;
  testId?: string;
}) {
  return <svg testId={testId} source={sources[name]} style={styles.icon} />;
}
