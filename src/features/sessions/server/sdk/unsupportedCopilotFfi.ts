const unsupportedCopilotFfi = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "Toy Box uses the Copilot CLI over stdio; its in-process FFI transport is unavailable.",
      );
    },
  },
);

export default unsupportedCopilotFfi;
