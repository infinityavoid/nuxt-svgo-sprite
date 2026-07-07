export interface CollectionIconDTO {
  id: string
  componentName: string
}

export interface CollectionDTO {
  name: string
  icons: CollectionIconDTO[]
  iconCount: number
  injected: boolean
}

export interface ServerFunctions {
  getCollections(): CollectionDTO[]
}

export interface ClientFunctions {
  refresh(): void
}
