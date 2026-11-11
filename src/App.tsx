import { Route, Routes } from "react-router-dom";
import { SiteLayout } from "./components/SiteLayout";
import { GuidePage } from "./pages/GuidePage";
import { GuidesPage } from "./pages/GuidesPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SitePageView } from "./pages/SitePageView";
import { ToolPage } from "./pages/ToolPage";
import { ToolsIndexPage } from "./pages/ToolsIndexPage";

export function App() {
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route index element={<HomePage />} />
        <Route path="tools" element={<ToolsIndexPage />} />
        <Route path="tools/:slug" element={<ToolPage />} />
        <Route path="guides" element={<GuidesPage />} />
        <Route path="guides/:slug" element={<GuidePage />} />
        <Route path=":slug" element={<SitePageView />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
