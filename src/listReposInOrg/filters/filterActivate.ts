export const filterActivate = <S extends { archived?: boolean }>(
  repos: S[]
) => {
  return repos.filter((repo) => {
    return !repo.archived;
  });
};
