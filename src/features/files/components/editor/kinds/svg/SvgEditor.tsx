import { useEffectEvent, useLayoutEffect, useState } from "react";
import type { EditorProps } from "../index";
import { SvgDocument } from "./document";
import { Editor } from "./editor/Editor";
import { createEditorStore } from "./store";
import { SvgPaneActions } from "./toolbar/SvgPaneActions";

export function SvgEditor({ mode, variant, baseUri, file }: EditorProps) {
  const source = file.content ?? "";
  const revision = file.revision;
  const readOnly = mode === "read";

  const [document] = useState(() => new SvgDocument());
  const [store] = useState(() => createEditorStore(document, readOnly));

  const saveSource = useEffectEvent(file.save);

  useLayoutEffect(
    () => document.subscribeToSource((nextSource) => saveSource(nextSource)),
    [document],
  );

  useLayoutEffect(() => {
    store.actions.loadDocument(source);
  }, [revision, source, store]);

  useLayoutEffect(() => store.actions.setReadOnly(readOnly), [readOnly, store]);

  return (
    <>
      <SvgPaneActions document={document} store={store} variant={variant} />
      <Editor document={document} store={store} baseUri={baseUri} />
    </>
  );
}
