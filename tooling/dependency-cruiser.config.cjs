/**
 * dependency-cruiser config — enforces EDICT's layered architecture at build
 * time. The layers, inside-out:
 *
 *   shared        no dependencies
 *   domain        may import shared only
 *   evaluation    may import domain, shared
 *   compilation   may import domain, shared
 *   safety        may import domain, evaluation, shared
 *   analytics     may import domain, evaluation, safety, shared
 *   infrastructure  may import domain, evaluation, safety, analytics, shared
 *   orchestration may import everything above
 *   interface     may import everything above
 *   bootstrap     wires interface + orchestration + infrastructure
 *
 * Violations of these rules tell you something is leaking the wrong way
 * (e.g. domain depending on infrastructure). Caught here, fixed cheaply;
 * caught at runtime, much more expensive.
 */

const denyInward = (from, to) => ({
  name: `no-${from}-importing-${to}`,
  severity: 'error',
  comment: `${from} must not import from ${to}.`,
  from: { path: `^source/${from}/` },
  to: { path: `^source/${to}/` },
});

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies indicate a layering violation.',
      from: {},
      to: { circular: true },
    },
    denyInward('domain', 'infrastructure'),
    denyInward('domain', 'interface'),
    denyInward('domain', 'orchestration'),
    denyInward('evaluation', 'infrastructure'),
    denyInward('evaluation', 'interface'),
    denyInward('compilation', 'infrastructure'),
    denyInward('compilation', 'interface'),
    denyInward('safety', 'infrastructure'),
    denyInward('safety', 'interface'),
    denyInward('analytics', 'infrastructure'),
    denyInward('analytics', 'interface'),
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
