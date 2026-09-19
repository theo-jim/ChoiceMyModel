import type { UseCase } from "../types.js";

export interface EvalCase {
  id: string;
  text: string;
  expectedUseCase: UseCase;
}

/**
 * Seed set only. The post this project is based on makes the point explicitly:
 * routing should be pinned by evals against your OWN traffic, not vibes. Grow
 * this file with real messages from herd/herdr (and their correct label) as
 * you collect them — that's what turns DEFAULT_ROUTING_TABLE from a guess
 * into the "output of the work" the post describes.
 */
export const EVAL_CASES: EvalCase[] = [
  { id: "lookup-1", text: "Quel est le SIRET qu'on a enregistré pour le client Dupont SAS ?", expectedUseCase: "lookup" },
  { id: "lookup-2", text: "Quel plan tarifaire GHL a ce compte client ?", expectedUseCase: "lookup" },
  { id: "summarization-1", text: "Résume ce fil de 40 messages en 3 points.", expectedUseCase: "summarization" },
  { id: "summarization-2", text: "Fais un résumé en une phrase du dernier ticket support.", expectedUseCase: "summarization" },
  { id: "communication-1", text: "Rédige un email de relance pour une facture impayée.", expectedUseCase: "communication" },
  { id: "communication-2", text: "Réponds à ce client mécontent sur le retard de livraison.", expectedUseCase: "communication" },
  { id: "analytics-1", text: "Compare le taux de conversion des leads ce mois-ci vs le mois dernier, par campagne.", expectedUseCase: "analytics" },
  { id: "analytics-2", text: "Quel est le taux d'échec des paiements sur ghl-payment-hub cette semaine ?", expectedUseCase: "analytics" },
  { id: "investigation-1", text: "Comprends pourquoi la synchro doctolib-to-ghl a silencieusement perdu 12 rendez-vous hier.", expectedUseCase: "investigation" },
  { id: "investigation-2", text: "Le webhook Crisp vers GHL a renvoyé des erreurs 500 par intermittence, trouve la cause.", expectedUseCase: "investigation" },
  { id: "deliverable-1", text: "Rédige le guide complet d'onboarding pour les nouveaux clients, en PDF.", expectedUseCase: "deliverable" },
  { id: "deliverable-2", text: "Prépare la présentation client pour le bilan trimestriel.", expectedUseCase: "deliverable" },
  { id: "automation-1", text: "Mets à jour le statut GHL de chaque contact qui a payé sa facture aujourd'hui.", expectedUseCase: "automation" },
  { id: "automation-2", text: "Archive automatiquement les leads inactifs depuis plus de 90 jours.", expectedUseCase: "automation" },
];
