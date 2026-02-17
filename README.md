# coder.qa Document Comparison

Secure, in-browser PDF diffing tailored for engineering and compliance teams. Upload a baseline and revised document, generate highlights locally, and review changes side by side without sending data to external services.

## Features

- Secure local processing via Web Workers and `pdfjs-dist`; no documents leave the browser.
- Multi-stage workflow with contextual messaging and animated icons powered by `react-icons`.
- Enterprise trust signals surfaced through a rich About overlay, SEO-friendly metadata, and modern typography.
- Responsive Ant Design layout with conditional rendering that hides previews until the diff is ready.
- Structured diff statistics with token overlays, highlight colors, and accessibility-focused placeholders.

## Getting Started

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+

### Installation

```bash
npm install
```

### Development Server

```bash
npm run dev
```

The app runs at http://localhost:5173 by default with hot module replacement enabled.

### Production Build

```bash
npm run build
```

Bundles the application with Vite and TypeScript project references. Output is placed in `dist/`.

### Preview Production Build

```bash
npm run preview
```

Serves the built assets locally to validate the optimized bundle.

## Project Structure

- `src/App.tsx` – Core orchestration: uploads, comparison lifecycle, conditional rendering.
- `src/components/` – Modular UI, including `UploadPanel`, `SideBySidePdfComparison`, `HeroSection`, `AppHeader`, and the trust-focused `AboutSection`.
- `src/workers/diffWorker.ts` – Runs diff computation in a dedicated worker to keep the UI responsive.
- `public/` – Static assets served as-is (currently minimal; customize with org-specific icons as needed).

## Tech Stack

- **React 18 + TypeScript** for component-driven UI.
- **Vite** for fast bundling and dev server.
- **Ant Design** for layout primitives and form controls.
- **react-icons** for lightweight SVG icons.
- **pdfjs-dist** and `diff` for document parsing and text differencing.

## Accessibility & UX Notes

- All icons include `aria-hidden` where used purely decoratively.
- Placeholder states offer iconography plus descriptive text for screen readers.
- Buttons and interactive elements respect focus styles and keyboard navigation.

## SEO Considerations

- Rich meta tags (Open Graph, Twitter, crawler directives) configured in `index.html`.
- Canonical URL and JSON-LD schema ensure accurate search indexing and social previews.

## Future Enhancements

- Add automated visual regression tests for PDF rendering states.
- Investigate chunk splitting for large pdf.js payloads to reduce bundle warnings.
- Wire up CI/CD with linting and auditing tasks (`npm audit`, accessibility checks).

## License

This project began from the Vite React TypeScript template and has been customized for coder.qa use. Add licensing details here if you plan to distribute the application.
