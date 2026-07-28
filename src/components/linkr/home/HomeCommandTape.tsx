import { Zap } from "lucide-react";

const commands = [
  "@linkrcash buy $100 of $PUMP",
  "@linkrcash sell 50% of this",
  "@linkrcash launch $TOKEN with this image",
  "@linkrcash send 0.25 ETH to 7xKQ...",
  "@linkrcash what is the CA above?",
];

export function HomeCommandTape() {
  return (
    <section className="sm-command-tape" aria-label="Popular Linkr commands">
      <div className="sm-command-label">
        <Zap aria-hidden="true" size={18} />
        Popular Commands
      </div>
      <div className="sm-tape-track">
        {commands.concat(commands).map((command, index) => (
          <span key={`${command}-${index}`}>{command}</span>
        ))}
      </div>
    </section>
  );
}
