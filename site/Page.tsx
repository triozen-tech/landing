import BootLoader from "./components/BootLoader";
import Stage from "./components/Stage";

// Last Landing: a battle-royale game lobby told in six chapters (story mode). Storyboard, Motion map and
// timings: site/DESIGN.md. One pinned 16:9 stage: scrolling plays the film forward (Stage.tsx).
export default function Page() {
  return (
    <main id="top" className="bg-black text-fg">
      <BootLoader />
      <Stage />
    </main>
  );
}
