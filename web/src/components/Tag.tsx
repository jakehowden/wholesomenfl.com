import type { Tag as TagValue } from "../types/data";

export function Tag({ tag }: { tag: TagValue }) {
  return <span className={"tag tag-" + tag}>{tag}</span>;
}
