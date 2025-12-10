export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <h1 className="text-4xl font-bold">PRELUDE</h1>
        <p className="text-lg text-center sm:text-left">
          Process and Replay for LLM Usage and Drafting Events
        </p>
        <div className="flex flex-col gap-4 items-center sm:items-start">
          <h2 className="text-2xl font-semibold">Getting Started</h2>
          <p className="text-sm">
            Access the test assignment at:{" "}
            <a
              href="/s/test-assignment-123"
              className="underline text-blue-600 hover:text-blue-800"
            >
              /s/test-assignment-123
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
