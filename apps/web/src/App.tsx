import { NavLink, Route, Routes } from "react-router-dom";
import { EntityDetailPage } from "./pages/EntityDetail";
import { EntityListPage } from "./pages/EntityList";
import { ExtractPage } from "./pages/Extract";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`;

export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <span className="text-lg font-semibold text-slate-900">Payna</span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Entities
            </NavLink>
            <NavLink to="/extract" className={navLinkClass}>
              Extract
            </NavLink>
          </nav>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<EntityListPage />} />
        <Route path="/entities/:id" element={<EntityDetailPage />} />
        <Route path="/extract" element={<ExtractPage />} />
      </Routes>
    </div>
  );
}
