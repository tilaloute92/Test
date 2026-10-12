import { useEffect, useRef, useState } from 'react';
import type { Tab } from '../App';
import { ALL_TABS, MOBILE_TABS, NAV_GROUPS, PRIMARY_TABS, groupOf, navEntry } from '../lib/navigation';

/**
 * Barre de navigation.
 *
 * Deux formes pour deux usages, et non une seule rangée rétrécie :
 *
 *   - ÉCRAN LARGE : les deux onglets quotidiens, puis trois menus. Les huit autres cessent
 *     d'occuper la barre en permanence alors qu'on les ouvre une fois par semaine.
 *   - TÉLÉPHONE : une barre fixe en bas, comme toute application mobile — quatre entrées
 *     plus « Plus ». L'ancienne rangée horizontale obligeait à faire défiler une barre dont
 *     rien n'indiquait qu'elle continuait, et les derniers onglets étaient introuvables.
 */

export function DesktopNav({
  tab,
  onSelect,
  onSearch,
}: {
  tab: Tab;
  onSelect: (t: Tab) => void;
  onSearch: () => void;
}) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  const groupeActif = groupOf(tab);

  // Fermeture au clavier : un menu ouvert qu'Échap ne ferme pas oblige à viser la souris
  // ailleurs, ce qui change d'écran par accident.
  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ouvert]);

  const choisir = (t: Tab) => {
    setOuvert(null);
    onSelect(t);
  };

  return (
    <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
      {PRIMARY_TABS.map((e) => (
        <button
          key={e.id}
          onClick={() => choisir(e.id)}
          title={e.description}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
            tab === e.id ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          {e.label}
        </button>
      ))}

      <span className="mx-1 h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

      {NAV_GROUPS.map((g) => {
        const estOuvert = ouvert === g.label;
        return (
          <div key={g.label} className="relative">
            <button
              onClick={() => setOuvert(estOuvert ? null : g.label)}
              aria-expanded={estOuvert}
              aria-haspopup="menu"
              className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                estOuvert || groupeActif === g.label
                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {g.label}
              {/* Le groupe qui contient l'onglet ouvert est marqué : sans ce point, on perd
                  de vue où l'on se trouve dès que l'écran n'est plus dans la barre. */}
              {groupeActif === g.label && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden="true" />}
              <span className="text-[10px] text-slate-400" aria-hidden="true">
                ▾
              </span>
            </button>
            {estOuvert && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOuvert(null)} />
                <div role="menu" className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {g.entries.map((e) => (
                    <button
                      key={e.id}
                      role="menuitem"
                      onClick={() => choisir(e.id)}
                      className={`block w-full rounded-md px-2.5 py-1.5 text-left ${
                        tab === e.id ? 'bg-violet-50 dark:bg-violet-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className={`block text-sm ${tab === e.id ? 'font-medium text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-slate-200'}`}>
                        {e.label}
                      </span>
                      <span className="block text-xs text-slate-400">{e.description}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}

      <button
        onClick={onSearch}
        title="Rechercher une tâche, une initiative, un COPIL, une personne"
        className="ml-2 flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        <span aria-hidden="true">⌕</span>
        <span className="hidden xl:inline">Rechercher…</span>
        <kbd className="rounded border border-slate-200 px-1 text-[10px] dark:border-slate-700">Ctrl K</kbd>
      </button>
    </nav>
  );
}

/**
 * Barre fixe en bas, sur téléphone et petite tablette. `pb-[env(safe-area-inset-bottom)]`
 * tient compte de la barre système des iPhone récents, sans quoi la dernière entrée se
 * retrouve sous le trait d'accueil et ne répond pas au doigt.
 */
export function MobileTabBar({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  const [plus, setPlus] = useState(false);
  const entrees = MOBILE_TABS.map((id) => navEntry(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
  const dansPlus = !MOBILE_TABS.includes(tab);

  return (
    <>
      {plus && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setPlus(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
            {NAV_GROUPS.map((g) => (
              <div key={g.label} className="mb-3">
                <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.entries.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        onSelect(e.id);
                        setPlus(false);
                      }}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm ${
                        tab === e.id
                          ? 'border-violet-300 bg-violet-50 font-medium text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300'
                          : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span aria-hidden="true" className="shrink-0 text-slate-400">
                        {e.icon}
                      </span>
                      <span className="min-w-0 truncate">{e.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] print:hidden lg:hidden dark:border-slate-800 dark:bg-slate-950">
        {entrees.map((e) => (
          <button
            key={e.id}
            onClick={() => onSelect(e.id)}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5"
            aria-current={tab === e.id ? 'page' : undefined}
          >
            <span aria-hidden="true" className={`text-base leading-none ${tab === e.id ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400'}`}>
              {e.icon}
            </span>
            <span className={`max-w-full truncate text-[10px] ${tab === e.id ? 'font-medium text-violet-600 dark:text-violet-400' : 'text-slate-400'}`}>
              {e.short ?? e.label}
            </span>
          </button>
        ))}
        <button onClick={() => setPlus(true)} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5">
          <span aria-hidden="true" className={`text-base leading-none ${dansPlus ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400'}`}>
            ⋯
          </span>
          <span className={`text-[10px] ${dansPlus ? 'font-medium text-violet-600 dark:text-violet-400' : 'text-slate-400'}`}>
            {/* Le nom de l'écran en cours plutôt que « Plus » : sinon, dès qu'on ouvre un
                écran du menu, plus rien dans la barre ne dit où l'on se trouve. */}
            {dansPlus ? navEntry(tab)?.short ?? 'Plus' : 'Plus'}
          </span>
        </button>
      </nav>
    </>
  );
}

/** Repli des écrans larges entre 640 et 1024 px : la barre groupée n'y tient pas encore,
 *  la barre basse y serait inutile. Une liste déroulante simple fait l'affaire. */
export function CompactNav({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  const ref = useRef<HTMLSelectElement>(null);
  return (
    <select
      ref={ref}
      value={tab}
      onChange={(e) => onSelect(e.target.value as Tab)}
      aria-label="Changer d'écran"
      className="hidden rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white sm:block lg:hidden"
    >
      {ALL_TABS.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label}
        </option>
      ))}
    </select>
  );
}
