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
