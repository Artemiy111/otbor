/**
 * The state object sent to the model. Built from vacancy fields and the
 * employer profile; no site URL, logo or badges (the design doc rules them
 * out). Any change here changes what the model sees, so it bumps the input
 * hash; hashing itself lives in the cloud (`stableHash`), the domain stays pure.
 */

export interface AnalysisEmployerInput {
  readonly name: string | null
  /** hh `category`, e.g. `agency`, `employer`. */
  readonly category: string | null
  readonly sizeCategory: string | null
  readonly address: string | null
  readonly accreditedIt: boolean | null
  readonly industries: ReadonlyArray<string> | null
  readonly descriptionText: string | null
}

export interface AnalysisInput {
  readonly title: string
  readonly areaName: string | null
  readonly salaryFrom: number | null
  readonly salaryTo: number | null
  readonly salaryCurrency: string | null
  readonly workFormats: ReadonlyArray<string> | null
  readonly experienceCode: string | null
  readonly descriptionText: string | null
  readonly employer: AnalysisEmployerInput | null
}

export interface AnalysisState {
  readonly title: string
  readonly employer: {
    readonly name: string | null
    readonly kind: string | null
    readonly size: string | null
    readonly city: string | null
    readonly it_accredited: boolean | null
    readonly industries: ReadonlyArray<string>
    readonly about: string | null
  }
  readonly city: string | null
  readonly salary: readonly [number | null, number | null, string | null]
  readonly work_formats: ReadonlyArray<string>
  readonly experience: string | null
  readonly description: string | null
}

export const buildAnalysisState = (input: AnalysisInput): AnalysisState => {
  const employer = input.employer
  return {
    title: input.title,
    employer: {
      name: employer?.name ?? null,
      kind: employer?.category ?? null,
      size: employer?.sizeCategory ?? null,
      city: employer?.address ?? null,
      it_accredited: employer?.accreditedIt ?? null,
      industries: employer?.industries ?? [],
      about: employer?.descriptionText ?? null
    },
    city: input.areaName,
    salary: [input.salaryFrom, input.salaryTo, input.salaryCurrency],
    work_formats: input.workFormats ?? [],
    experience: input.experienceCode,
    description: input.descriptionText
  }
}
