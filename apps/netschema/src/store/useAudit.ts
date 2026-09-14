import { auditDiagram, type HaReport } from '../lib/ha'
import { useDiagram } from './useDiagram'
import type { Diagram } from '../types'

let cachedDiagram: Diagram | null = null
let cachedReport: HaReport | null = null

/**
 * L'analyse est recalculée à chaque modification du schéma, mais une seule fois :
 * le résultat est mémorisé sur la référence de l'objet `diagram`, que le store remplace
 * à chaque changement.
 */
export function reportFor(diagram: Diagram): HaReport {
  if (cachedDiagram === diagram && cachedReport) return cachedReport
  cachedDiagram = diagram
  cachedReport = auditDiagram(diagram)
  return cachedReport
}

export function useAudit(): HaReport {
  return reportFor(useDiagram((s) => s.diagram))
}
