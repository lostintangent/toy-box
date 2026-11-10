import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DialogHost, openDialog } from "./DialogHost";

test("a closed dialog stays rendered closed until the next opening replaces it", () => {
  let close = () => {};
  openDialog(({ open, onOpenChange }) => {
    close = () => onOpenChange(false);
    return <p>{`first ${open}`}</p>;
  });
  expect(renderToStaticMarkup(<DialogHost />)).toBe("<p>first true</p>");

  close();
  expect(renderToStaticMarkup(<DialogHost />)).toBe("<p>first false</p>");

  openDialog(({ open }) => <p>{`second ${open}`}</p>);
  expect(renderToStaticMarkup(<DialogHost />)).toBe("<p>second true</p>");
});
