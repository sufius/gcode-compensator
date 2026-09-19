# Gespeicherte Arbeitsprojekte

Jedes Unterverzeichnis ist ein eigenständiges, mit Git versionierbares Arbeitsprojekt:

```text
projektname/
├── project.json
└── inputs/
    ├── contour.dxf
    └── toolpath.nc
```

`project.json` enthält die Schema-Version, SHA-256-Prüfsummen, den DXF-Drehwinkel,
den ausgewählten Nullpunkt und weitere Ansichtseinstellungen. Die Eingabedateien
bleiben unverändert; Transformationen werden beim Laden reproduzierbar angewendet.

Um einen Arbeitsstand zu teilen, das vollständige Projektverzeichnis zu Git hinzufügen
und committen.

Dateien können auch nach dem Anlegen ergänzt werden: Projekt öffnen, DXF und/oder
G-Code hochladen und **Speichern** wählen. Die hochgeladenen Dateien werden unter
`inputs/` abgelegt und in `project.json` verknüpft. Vorhandene G-Code-Versionen
bleiben erhalten. Beim erneuten Öffnen wird weiterhin die aktive Version geladen.

Nullpunkt und Drehwinkel werden bei einem geöffneten Projekt automatisch und auch
über **Speichern** in `project.json` gesichert. Dabei wird die aktive G-Code-Version
ebenfalls aktualisiert, sodass ihre Ausrichtung beim Versionswechsel erhalten bleibt.
