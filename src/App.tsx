import { BrowserRouter, Routes, Route } from "react-router-dom";
import EventsIndex from "./pages/EventsIndex";
import EventDetail from "./pages/EventDetail";
import SearchPage from "./pages/SearchPage";
import AboutPage from "./pages/AboutPage";
import CreditsPage from "./pages/CreditsPage";

const BASENAME = import.meta.env.BASE_URL;

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <Routes>
        <Route path="/" element={<EventsIndex />} />
        <Route path="/event/:eventId" element={<EventDetail />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/credits" element={<CreditsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
