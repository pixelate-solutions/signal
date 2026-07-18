import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function run(command, args, options = {}) {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["test:source"]);

const documentRoot = join(root, "services", "document-worker");
const venvRoot = join(documentRoot, ".venv");
const python = join(venvRoot, "bin", "python");
if (!existsSync(python)) {
  run("python3", ["-m", "venv", ".venv"], { cwd: documentRoot });
  run(
    python,
    [
      "-m",
      "pip",
      "install",
      "-e",
      ".",
      "pytest",
      "ruff",
      "mypy",
      "httpx",
      "types-Pillow",
      "types-openpyxl",
      "types-python-dateutil",
      "types-reportlab",
    ],
    { cwd: documentRoot },
  );
}
const documentBin = join(venvRoot, "bin");
const documentEnvironment = { PATH: `${documentBin}${delimiter}${process.env.PATH ?? ""}` };
run(join(documentBin, "ruff"), ["format", "--check", "app", "tests"], {
  cwd: documentRoot,
  env: documentEnvironment,
});
run(join(documentBin, "ruff"), ["check", "app", "tests"], {
  cwd: documentRoot,
  env: documentEnvironment,
});
run(join(documentBin, "mypy"), ["app", "tests"], { cwd: documentRoot, env: documentEnvironment });
run(join(documentBin, "pytest"), ["-q"], { cwd: documentRoot, env: documentEnvironment });

run("docker", ["compose", "config", "--quiet"]);
run("docker", [
  "run",
  "--rm",
  "--volume",
  `${join(root, "infra", "opa")}:/policies:ro`,
  "openpolicyagent/opa:1.7.1-static",
  "test",
  "/policies/signal",
]);
run("docker", [
  "run",
  "--rm",
  "--volume",
  `${root}:/work:ro`,
  "alpine/helm:3.18.4",
  "lint",
  "/work/infra/helm/signal",
]);

const terraform = spawnSync("terraform", ["version"], { stdio: "ignore" });
if (terraform.status === 0) {
  run("terraform", ["-chdir=infra/terraform/aws", "fmt", "-check", "-recursive"]);
  run("terraform", ["-chdir=infra/terraform/aws", "init", "-backend=false", "-input=false"]);
  run("terraform", ["-chdir=infra/terraform/aws", "validate"]);
} else {
  process.stdout.write(
    "Terraform is not installed; Docker/OPA/Helm validations passed, Terraform validation was skipped.\n",
  );
}

process.stdout.write("\nSignal complete test suite passed.\n");
